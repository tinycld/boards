package boards

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// member_owner_guard_test.go proves a board cannot lose its last owner via the
// API. The Share dialog's memberRowActionsFor already refuses to render the
// sole owner's demote/remove/leave — but a dialog guard alone is exactly the
// gap mail shipped (mailbox_owner_guard_test.go documents it): the last owner
// could still self-demote or self-delete with a raw request. These tests bind
// ONLY the guard, so they measure it rather than the RLS rules (which the
// *_rls_test.go suites own).

func setupMemberGuardEnv(t *testing.T) *cardsEnv {
	t.Helper()
	env := setupCardsEnv(t)
	registerMemberLastOwnerGuard(env.app)
	return env
}

// triggerMemberUpdate invokes the OnRecordUpdateRequest hook chain the way the
// API would (see mail's mailbox_owner_guard_test.go for the pattern).
func triggerMemberUpdate(
	t *testing.T,
	app *tests.TestApp,
	caller *core.Record,
	rowID string,
	mutate func(*core.Record),
) error {
	t.Helper()
	fresh, err := app.FindRecordById("boards_project_members", rowID)
	if err != nil {
		t.Fatalf("reload row: %v", err)
	}
	mutate(fresh)
	col, err := app.FindCollectionByNameOrId("boards_project_members")
	if err != nil {
		t.Fatal(err)
	}
	e := &core.RecordRequestEvent{
		RequestEvent: &core.RequestEvent{Auth: caller, App: app},
		Record:       fresh,
	}
	e.Collection = col
	return app.OnRecordUpdateRequest("boards_project_members").
		Trigger(e, func(_ *core.RecordRequestEvent) error {
			return app.Save(fresh)
		})
}

func triggerMemberDelete(
	t *testing.T,
	app *tests.TestApp,
	caller *core.Record,
	rowID string,
) error {
	t.Helper()
	fresh, err := app.FindRecordById("boards_project_members", rowID)
	if err != nil {
		t.Fatalf("reload row: %v", err)
	}
	col, err := app.FindCollectionByNameOrId("boards_project_members")
	if err != nil {
		t.Fatal(err)
	}
	e := &core.RecordRequestEvent{
		RequestEvent: &core.RequestEvent{Auth: caller, App: app},
		Record:       fresh,
	}
	e.Collection = col
	return app.OnRecordDeleteRequest("boards_project_members").
		Trigger(e, func(_ *core.RecordRequestEvent) error {
			return app.Delete(fresh)
		})
}

func memberRowOf(t *testing.T, env *cardsEnv, user *core.Record) *core.Record {
	t.Helper()
	row, err := env.app.FindFirstRecordByFilter(
		"boards_project_members",
		"project = {:p} && user = {:u}",
		map[string]any{"p": env.project.Id, "u": user.Id},
	)
	if err != nil {
		t.Fatalf("find membership row: %v", err)
	}
	return row
}

func superuser(t *testing.T, env *cardsEnv) *core.Record {
	t.Helper()
	col, err := env.app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatalf("find superusers: %v", err)
	}
	r := core.NewRecord(col)
	r.SetEmail("root@test.local")
	r.SetPassword("Password123!")
	if err := env.app.Save(r); err != nil {
		t.Fatalf("save superuser: %v", err)
	}
	return r
}

func TestMemberGuard_BlocksSelfDemotionOfLastOwner(t *testing.T) {
	env := setupMemberGuardEnv(t)
	row := memberRowOf(t, env, env.owner)

	err := triggerMemberUpdate(t, env.app, env.owner, row.Id, func(r *core.Record) {
		r.Set("role", "editor")
	})
	if err == nil {
		t.Fatal("demoting the board's last owner should be rejected")
	}

	fresh, _ := env.app.FindRecordById("boards_project_members", row.Id)
	if fresh.GetString("role") != "owner" {
		t.Errorf("role should still be owner, got %q", fresh.GetString("role"))
	}
}

func TestMemberGuard_BlocksDeletingLastOwnerRow(t *testing.T) {
	env := setupMemberGuardEnv(t)
	row := memberRowOf(t, env, env.owner)

	if err := triggerMemberDelete(t, env.app, env.owner, row.Id); err == nil {
		t.Fatal("deleting the board's last owner row should be rejected")
	}
	if _, err := env.app.FindRecordById("boards_project_members", row.Id); err != nil {
		t.Fatalf("owner row should still exist: %v", err)
	}
}

func TestMemberGuard_SecondOwnerUnblocksDemotionAndLeave(t *testing.T) {
	env := setupMemberGuardEnv(t)
	editorRow := memberRowOf(t, env, env.editor)
	if err := triggerMemberUpdate(t, env.app, env.owner, editorRow.Id, func(r *core.Record) {
		r.Set("role", "owner")
	}); err != nil {
		t.Fatalf("promoting a second owner should be allowed: %v", err)
	}

	ownerRow := memberRowOf(t, env, env.owner)
	if err := triggerMemberUpdate(t, env.app, env.owner, ownerRow.Id, func(r *core.Record) {
		r.Set("role", "viewer")
	}); err != nil {
		t.Fatalf("demoting one of two owners should be allowed: %v", err)
	}

	// The demoted row is no longer an owner row, so its deletion (leaving the
	// board) must pass the guard untouched.
	if err := triggerMemberDelete(t, env.app, env.owner, ownerRow.Id); err != nil {
		t.Fatalf("a demoted ex-owner leaving should be allowed: %v", err)
	}
}

func TestMemberGuard_AllowsNonOwnerSelfLeave(t *testing.T) {
	env := setupMemberGuardEnv(t)
	row := memberRowOf(t, env, env.viewer)

	if err := triggerMemberDelete(t, env.app, env.viewer, row.Id); err != nil {
		t.Fatalf("a viewer leaving the board should be allowed: %v", err)
	}
}

func TestMemberGuard_SuperuserBypasses(t *testing.T) {
	env := setupMemberGuardEnv(t)
	root := superuser(t, env)
	row := memberRowOf(t, env, env.owner)

	if err := triggerMemberUpdate(t, env.app, root, row.Id, func(r *core.Record) {
		r.Set("role", "viewer")
	}); err != nil {
		t.Fatalf("a superuser demoting the last owner should be allowed: %v", err)
	}
}
