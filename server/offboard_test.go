package boards

import (
	"errors"
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/offboard"
)

// offboard_test.go covers what happens to boards when their owner leaves: the
// offboard handler that hands a sole-owned board over (offboard.go), and the
// guard that stops a direct users delete from stripping a shared board of its
// only owner. Both run against the SHIPPED schema (real migrations, so the
// unique (project, user) index is present), with the same registrations
// registerShared makes.
//
// env.owner created env.project and is its only owner. env.member is a viewer
// on it and wrote env.card. env.outsider has no board.

type boardsOffboardEnv struct {
	app           *tests.TestApp
	owner         *core.Record
	member        *core.Record
	outsider      *core.Record
	admin         *core.Record
	project       *core.Record
	card          *core.Record
	ownerToken    string
	outsiderToken string
}

func setupBoardsOffboardApp(t *testing.T) *boardsOffboardEnv {
	t.Helper()
	app := newCardsApp(t)
	offboard.ResetReassignableForTesting()
	offboard.ResetHandlersForTesting()
	t.Cleanup(func() {
		offboard.ResetReassignableForTesting()
		offboard.ResetHandlersForTesting()
	})
	registerOffboard()
	registerSoleOwnerDeleteGuard(app)

	env := &boardsOffboardEnv{app: app}
	env.owner = cardsUser(t, app, "ob-owner@test.local", "member")
	env.member = cardsUser(t, app, "ob-member@test.local", "member")
	env.outsider = cardsUser(t, app, "ob-outsider@test.local", "member")
	env.admin = cardsUser(t, app, "ob-admin@test.local", "admin")

	env.project = cardsProject(t, app, "Team Board", env.owner)
	cardsMember(t, app, env.project, env.owner, "owner")
	cardsMember(t, app, env.project, env.member, "viewer")
	list := cardsList(t, app, env.project, "To do", "a0")
	env.card = cardsCard(t, app, env.project, list, "Ship it", "a0", env.member)

	env.ownerToken = cardsToken(t, env.owner)
	env.outsiderToken = cardsToken(t, env.outsider)
	return env
}

func boardMembership(t *testing.T, app core.App, project, user *core.Record) *core.Record {
	t.Helper()
	rows, err := app.FindRecordsByFilter("boards_project_members",
		"project = {:p} && user = {:u}", "", 0, 0,
		map[string]any{"p": project.Id, "u": user.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) > 1 {
		t.Fatalf("%d memberships for one (project, user)", len(rows))
	}
	if len(rows) == 0 {
		return nil
	}
	return rows[0]
}

func requireBoardRole(t *testing.T, app core.App, project, user *core.Record, want string) {
	t.Helper()
	m := boardMembership(t, app, project, user)
	got := ""
	if m != nil {
		got = m.GetString("role")
	}
	if got != want {
		t.Errorf("role of %s on %q = %q, want %q", user.Email(), project.GetString("name"), got, want)
	}
}

func requireBoardKept(t *testing.T, env *boardsOffboardEnv) {
	t.Helper()
	if _, err := env.app.FindRecordById("boards_projects", env.project.Id); err != nil {
		t.Fatalf("handed-over board is gone: %v", err)
	}
	if _, err := env.app.FindRecordById("boards_cards", env.card.Id); err != nil {
		t.Errorf("card on the handed-over board is gone: %v", err)
	}
}

func requireCreator(t *testing.T, app core.App, project, want *core.Record) {
	t.Helper()
	fresh, err := app.FindRecordById("boards_projects", project.Id)
	if err != nil {
		t.Fatalf("board %q is gone: %v", project.GetString("name"), err)
	}
	if got := fresh.GetString("created_by"); got != want.Id {
		t.Errorf("created_by of %q = %s, want %s (%s)", project.GetString("name"), got, want.Id, want.Email())
	}
}

func requireUserAnonymized(t *testing.T, app core.App, user *core.Record, want bool) {
	t.Helper()
	fresh, err := app.FindRecordById("users", user.Id)
	if err != nil {
		t.Fatalf("users row of %s is gone: %v", user.Email(), err)
	}
	if got := fresh.GetString("name") == "Deleted user"; got != want {
		t.Errorf("anonymized = %v, want %v", got, want)
	}
}

func TestBoardsOffboard_ReassignMovesSoleOwnedBoardToSuccessor(t *testing.T) {
	env := setupBoardsOffboardApp(t)

	if _, err := offboard.OffboardUser(env.app, env.owner.Id, offboard.Plan{
		Mode: offboard.ModeReassign, SuccessorUserID: env.outsider.Id,
	}, env.admin.Id); err != nil {
		t.Fatalf("OffboardUser: %v", err)
	}

	requireBoardRole(t, env.app, env.project, env.outsider, "owner")
	requireBoardRole(t, env.app, env.project, env.member, "viewer")
	requireCreator(t, env.app, env.project, env.outsider)
	requireBoardKept(t, env)
	requireUserAnonymized(t, env.app, env.owner, true)
}

// The successor is already a viewer: the row is upgraded, not duplicated
// (the unique index would fail an insert).
func TestBoardsOffboard_ReassignUpgradesExistingMembership(t *testing.T) {
	env := setupBoardsOffboardApp(t)
	before := boardMembership(t, env.app, env.project, env.member)

	if _, err := offboard.OffboardUser(env.app, env.owner.Id, offboard.Plan{
		Mode: offboard.ModeReassign, SuccessorUserID: env.member.Id,
	}, env.owner.Id); err != nil {
		t.Fatalf("OffboardUser: %v", err)
	}

	after := boardMembership(t, env.app, env.project, env.member)
	if after == nil || after.Id != before.Id || after.GetString("role") != "owner" {
		t.Errorf("membership not upgraded in place: before=%v after=%v", before, after)
	}
	requireBoardKept(t, env)
}

// A group grant gives the successor a derived row. The derived row belongs to
// the grant (core re-syncs its role and removes it when the grant goes), so
// ownership must land on a direct row of its own: upgrading the derived row
// would give an owner role that the grant can take away again.
func TestBoardsOffboard_ReassignAddsDirectOwnerBesideDerivedRow(t *testing.T) {
	env := setupBoardsOffboardApp(t)
	g := cardsGroup(t, env.app, "Reviewers")
	col, err := env.app.FindCollectionByNameOrId("boards_project_members")
	if err != nil {
		t.Fatal(err)
	}
	derived := core.NewRecord(col)
	derived.Set("project", env.project.Id)
	derived.Set("group", g.Id)
	derived.Set("user", env.outsider.Id)
	derived.Set("role", "editor")
	if err := env.app.Save(derived); err != nil {
		t.Fatalf("save derived row: %v", err)
	}

	if _, err := offboard.OffboardUser(env.app, env.owner.Id, offboard.Plan{
		Mode: offboard.ModeReassign, SuccessorUserID: env.outsider.Id,
	}, env.owner.Id); err != nil {
		t.Fatalf("OffboardUser: %v", err)
	}

	stillDerived, err := env.app.FindRecordById("boards_project_members", derived.Id)
	if err != nil {
		t.Fatalf("derived row is gone: %v", err)
	}
	if got := stillDerived.GetString("role"); got != "editor" {
		t.Errorf("derived row role = %q, want editor (it must not be upgraded)", got)
	}
	direct, err := env.app.FindFirstRecordByFilter("boards_project_members",
		"project = {:p} && user = {:u} && group = ''",
		map[string]any{"p": env.project.Id, "u": env.outsider.Id})
	if err != nil {
		t.Fatalf("no direct membership for the successor: %v", err)
	}
	if got := direct.GetString("role"); got != "owner" {
		t.Errorf("direct membership role = %q, want owner", got)
	}
	requireBoardKept(t, env)
}

// A board with another owner does not need the leaver, so the successor gets
// nothing on it. The leaver's own rows stay.
func TestBoardsOffboard_LeavesCoOwnedAndNonOwnerMembershipsAlone(t *testing.T) {
	env := setupBoardsOffboardApp(t)
	coOwned := cardsProject(t, env.app, "Co-owned", env.admin)
	cardsMember(t, env.app, coOwned, env.owner, "owner")
	cardsMember(t, env.app, coOwned, env.admin, "owner")
	viewed := cardsProject(t, env.app, "Someone else's", env.admin)
	cardsMember(t, env.app, viewed, env.admin, "owner")
	cardsMember(t, env.app, viewed, env.owner, "viewer")

	if _, err := offboard.OffboardUser(env.app, env.owner.Id, offboard.Plan{
		Mode: offboard.ModeReassign, SuccessorUserID: env.outsider.Id,
	}, env.owner.Id); err != nil {
		t.Fatalf("OffboardUser: %v", err)
	}

	requireBoardRole(t, env.app, coOwned, env.outsider, "")
	requireBoardRole(t, env.app, viewed, env.outsider, "")
	requireBoardRole(t, env.app, coOwned, env.owner, "owner")
	requireBoardRole(t, env.app, viewed, env.owner, "viewer")
	requireBoardRole(t, env.app, env.project, env.outsider, "owner")
}

// The leaver created the board, so core's delete_my_data pass used to delete
// it with every card on it. It is now handed to the acting admin instead.
func TestBoardsOffboard_DeleteMyDataByAdminMovesToAdmin(t *testing.T) {
	env := setupBoardsOffboardApp(t)

	if _, err := offboard.OffboardUser(env.app, env.owner.Id,
		offboard.Plan{Mode: offboard.ModeDeleteMyData}, env.admin.Id); err != nil {
		t.Fatalf("OffboardUser: %v", err)
	}

	requireBoardKept(t, env)
	requireBoardRole(t, env.app, env.project, env.admin, "owner")
	requireBoardRole(t, env.app, env.project, env.member, "viewer")
	requireCreator(t, env.app, env.project, env.admin)
	requireUserAnonymized(t, env.app, env.owner, true)
}

// A self-delete has no one to hand a shared board to. Like core's last-owner
// guard, it is refused with instructions, and nothing changes.
func TestBoardsOffboard_SelfDeleteMyDataRefusedForSharedBoard(t *testing.T) {
	env := setupBoardsOffboardApp(t)

	_, err := offboard.OffboardUser(env.app, env.owner.Id,
		offboard.Plan{Mode: offboard.ModeDeleteMyData}, env.owner.Id)
	if !errors.Is(err, offboard.ErrInvalidPlan) {
		t.Fatalf("err = %v, want ErrInvalidPlan", err)
	}
	requireBoardKept(t, env)
	requireBoardRole(t, env.app, env.project, env.owner, "owner")
	requireBoardRole(t, env.app, env.project, env.member, "viewer")
	requireUserAnonymized(t, env.app, env.owner, false)
}

// A board only the leaver uses costs nobody access, so a self-delete in
// delete-my-data mode goes through. A board the leaver created is the
// leaver's data and is deleted, as before; one someone else created is left.
func TestBoardsOffboard_SelfDeleteMyDataAllowedForPersonalBoards(t *testing.T) {
	env := setupBoardsOffboardApp(t)
	created := cardsProject(t, env.app, "Mine", env.outsider)
	cardsMember(t, env.app, created, env.outsider, "owner")
	inherited := cardsProject(t, env.app, "Inherited", env.admin)
	cardsMember(t, env.app, inherited, env.outsider, "owner")

	if _, err := offboard.OffboardUser(env.app, env.outsider.Id,
		offboard.Plan{Mode: offboard.ModeDeleteMyData}, env.outsider.Id); err != nil {
		t.Fatalf("OffboardUser: %v", err)
	}
	if _, err := env.app.FindRecordById("boards_projects", created.Id); err == nil {
		t.Error("the leaver's own unshared board survived delete_my_data")
	}
	requireBoardRole(t, env.app, inherited, env.outsider, "owner")
	requireUserAnonymized(t, env.app, env.outsider, true)
}

func TestBoardsOffboard_GuestSuccessorRefused(t *testing.T) {
	env := setupBoardsOffboardApp(t)
	guest := cardsUser(t, env.app, "ob-guest@test.local", "guest")

	_, err := offboard.OffboardUser(env.app, env.owner.Id, offboard.Plan{
		Mode: offboard.ModeReassign, SuccessorUserID: guest.Id,
	}, env.admin.Id)
	if !errors.Is(err, offboard.ErrInvalidPlan) {
		t.Fatalf("err = %v, want ErrInvalidPlan", err)
	}
	requireBoardRole(t, env.app, env.project, guest, "")
	requireCreator(t, env.app, env.project, env.owner)
	requireUserAnonymized(t, env.app, env.owner, false)
}

// A no-plan account delete (ModeKeep, self actor) has no one to hand a shared
// board to. Like the delete-my-data self-delete case, it is refused with
// instructions, and nothing changes: no board is deleted, no membership moves.
func TestBoardsOffboard_KeepRefusedForSoleOwnedSharedBoard(t *testing.T) {
	env := setupBoardsOffboardApp(t)

	_, err := offboard.OffboardUser(env.app, env.owner.Id,
		offboard.Plan{Mode: offboard.ModeKeep}, env.owner.Id)
	if !errors.Is(err, offboard.ErrInvalidPlan) {
		t.Fatalf("err = %v, want ErrInvalidPlan", err)
	}
	requireBoardKept(t, env)
	requireBoardRole(t, env.app, env.project, env.owner, "owner")
	requireBoardRole(t, env.app, env.project, env.member, "viewer")
	requireCreator(t, env.app, env.project, env.owner)
	requireUserAnonymized(t, env.app, env.owner, false)
}

// Without a sole-owned shared board, a no-plan account delete succeeds and
// leaves every board exactly as it was: ModeKeep never deletes a board, even
// one only the leaver used (unlike delete-my-data).
func TestBoardsOffboard_KeepAllowedAndLeavesBoardsInPlace(t *testing.T) {
	env := setupBoardsOffboardApp(t)
	created := cardsProject(t, env.app, "Mine", env.outsider)
	cardsMember(t, env.app, created, env.outsider, "owner")

	if _, err := offboard.OffboardUser(env.app, env.outsider.Id,
		offboard.Plan{Mode: offboard.ModeKeep}, env.outsider.Id); err != nil {
		t.Fatalf("OffboardUser: %v", err)
	}

	if _, err := env.app.FindRecordById("boards_projects", created.Id); err != nil {
		t.Errorf("board kept only by the leaver was deleted in ModeKeep: %v", err)
	}
	requireBoardRole(t, env.app, created, env.outsider, "owner")
	requireCreator(t, env.app, created, env.outsider)
	requireUserAnonymized(t, env.app, env.outsider, true)
}

// D: a direct REST delete of your own account, while you are the only owner of
// a board other people use, is refused and points at account deletion with a
// successor.
func TestBoardsUserDeleteGuard_RefusesSoleOwnerOfSharedBoard(t *testing.T) {
	env := setupBoardsOffboardApp(t)
	// The required created_by would block the delete on its own; point it at
	// someone else so the guard is the only thing that can refuse.
	env.project.Set("created_by", env.admin.Id)
	if err := env.app.Save(env.project); err != nil {
		t.Fatal(err)
	}

	(&tests.ApiScenario{
		Method:                http.MethodDelete,
		URL:                   "/api/collections/users/records/" + env.owner.Id,
		Headers:               map[string]string{"Authorization": env.ownerToken},
		ExpectedStatus:        http.StatusForbidden,
		ExpectedContent:       []string{`/api/account/delete`, `Team Board`, `choose a successor`},
		TestAppFactory:        func(testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)

	requireBoardRole(t, env.app, env.project, env.owner, "owner")
	requireBoardRole(t, env.app, env.project, env.member, "viewer")
}

func TestBoardsUserDeleteGuard_AllowsDeleteWithoutSharedSoleOwnedBoard(t *testing.T) {
	cases := []struct {
		name  string
		setup func(t *testing.T, env *boardsOffboardEnv)
	}{
		{
			name:  "no boards",
			setup: func(*testing.T, *boardsOffboardEnv) {},
		},
		{
			name: "personal board only",
			setup: func(t *testing.T, env *boardsOffboardEnv) {
				personal := cardsProject(t, env.app, "Personal", env.admin)
				cardsMember(t, env.app, personal, env.outsider, "owner")
			},
		},
		{
			name: "shared board with another owner",
			setup: func(t *testing.T, env *boardsOffboardEnv) {
				cardsMember(t, env.app, env.project, env.outsider, "owner")
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := setupBoardsOffboardApp(t)
			tc.setup(t, env)
			(&tests.ApiScenario{
				Method:                http.MethodDelete,
				URL:                   "/api/collections/users/records/" + env.outsider.Id,
				Headers:               map[string]string{"Authorization": env.outsiderToken},
				ExpectedStatus:        http.StatusNoContent,
				TestAppFactory:        func(testing.TB) *tests.TestApp { return env.app },
				DisableTestAppCleanup: true,
			}).Test(t)
			if _, err := env.app.FindRecordById("users", env.outsider.Id); err == nil {
				t.Error("users row still exists after an allowed delete")
			}
		})
	}
}

// The guard does not reach the offboard path: offboarding the sole owner of a
// shared board anonymizes the users row (it is never deleted) and hands the
// board over.
func TestBoardsUserDeleteGuard_OffboardUnaffected(t *testing.T) {
	env := setupBoardsOffboardApp(t)

	if _, err := offboard.OffboardUser(env.app, env.owner.Id, offboard.Plan{
		Mode: offboard.ModeReassign, SuccessorUserID: env.member.Id,
	}, env.owner.Id); err != nil {
		t.Fatalf("OffboardUser: %v", err)
	}
	requireUserAnonymized(t, env.app, env.owner, true)
	requireBoardRole(t, env.app, env.project, env.member, "owner")
}
