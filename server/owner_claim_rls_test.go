package boards

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/tests"
)

// The owner-claim hole, as mail had it.
//
// bootstrapFirstOwner admits an owner row on a project with NO members. Before
// 2040000001 it asked only "is the member set empty?", so ANY logged-in
// non-guest could POST {project:<memberless>, user:<self>, role:"owner"} and
// own a board they never made. A board is memberless in the create window
// (between the project insert and the owner insert) and whenever its last
// member row is gone — a users delete cascades member rows, and that cascade
// is not a request the last-owner guard sees. The branch now also requires
// `project.created_by = @request.auth.id`, and the project create rule pins
// created_by to the caller so the clause cannot be forged at create time.

// The attacker: an outsider claims a memberless board someone else made.
func TestCardsOwnerClaim_OutsiderCannotClaimMemberlessProject(t *testing.T) {
	env := setupCardsEnv(t)
	memberless := cardsProject(t, env.app, "Orphan", env.owner)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_project_members/records",
		token:  env.outsiderToken,
		body: `{"project":"` + memberless.Id + `","user":"` + env.outsider.Id +
			`","role":"owner"}`,
		want:  http.StatusBadRequest,
		after: requireNoMembers(memberless.Id),
	}.run(t, env)
}

// The create-window race: the board was just made by one user, and another
// non-guest tries to land the first owner row before the creator does.
func TestCardsOwnerClaim_EditorElsewhereCannotRaceTheCreator(t *testing.T) {
	env := setupCardsEnv(t)
	fresh := cardsProject(t, env.app, "Fresh", env.outsider)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_project_members/records",
		token:  env.editorToken,
		body: `{"project":"` + fresh.Id + `","user":"` + env.editor.Id +
			`","role":"owner"}`,
		want:  http.StatusBadRequest,
		after: requireNoMembers(fresh.Id),
	}.run(t, env)
}

// The legitimate flow, end to end over the API: the caller creates the
// project, then self-inserts as its first owner.
func TestCardsOwnerClaim_CreatorCreatesThenBootstraps(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_projects/records",
		token:  env.outsiderToken,
		body: `{"id":"claimproject001","name":"Mine","color":"#4A86E8",` +
			`"visibility":"private","created_by":"` + env.outsider.Id + `","archived":false}`,
		want:    http.StatusOK,
		content: []string{`"created_by":"` + env.outsider.Id + `"`},
	}.run(t, env)

	// A second ApiScenario on one app panics (duplicate route bind), so the
	// bootstrap half runs on a fresh env with the project the API just proved
	// it would accept.
	env2 := setupCardsEnv(t)
	fresh := cardsProject(t, env2.app, "Mine", env2.outsider)
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_project_members/records",
		token:  env2.outsiderToken,
		body: `{"project":"` + fresh.Id + `","user":"` + env2.outsider.Id +
			`","role":"owner","created_by":""}`,
		want:    http.StatusOK,
		content: []string{`"role":"owner"`},
	}.run(t, env2)
}

// created_by is what bootstrap trusts, so a caller must not be able to name
// someone else as the creator of a board they make.
func TestCardsOwnerClaim_CannotForgeCreatorOnProjectCreate(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_projects/records",
		token:  env.outsiderToken,
		body: `{"id":"forgedproject01","name":"Forged","color":"#4A86E8",` +
			`"visibility":"private","created_by":"` + env.owner.Id + `","archived":false}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

// An owner must not repoint created_by: that would hand the bootstrap branch
// of an orphaned board to a user of the owner's choosing.
func TestCardsOwnerClaim_OwnerCannotRewriteCreator(t *testing.T) {
	env := setupCardsEnv(t)
	original := env.project.GetString("created_by")

	req{
		method: http.MethodPatch,
		url:    "/api/collections/boards_projects/records/" + env.project.Id,
		token:  env.ownerToken,
		body:   `{"created_by":"` + env.outsider.Id + `"}`,
		want:   http.StatusNotFound,
		after: func(t testing.TB, app *tests.TestApp) {
			got, err := app.FindRecordById("boards_projects", env.project.Id)
			if err != nil {
				t.Fatalf("reload project: %v", err)
			}
			if got.GetString("created_by") != original {
				t.Fatalf("created_by = %q, want it unchanged (%q)", got.GetString("created_by"), original)
			}
		},
	}.run(t, env)
}

// The pin must not block an ordinary owner edit that echoes the stored value.
func TestCardsOwnerClaim_OwnerRenameEchoingCreatorStillWorks(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method:  http.MethodPatch,
		url:     "/api/collections/boards_projects/records/" + env.project.Id,
		token:   env.ownerToken,
		body:    `{"name":"Renamed","created_by":"` + env.project.GetString("created_by") + `"}`,
		want:    http.StatusOK,
		content: []string{`"name":"Renamed"`},
	}.run(t, env)
}

func TestCardsOwnerClaim_ShippedRulesPinTheCreator(t *testing.T) {
	env := setupCardsEnv(t)

	for _, c := range []struct{ collection, kind, clause, why string }{
		{"boards_project_members", "create",
			`user = @request.auth.id && role = "owner" && project.boards_project_members_via_project.id = "" && @request.auth.role != "guest" && project.created_by = @request.auth.id`,
			"without the creator clause any non-guest can own a memberless board"},
		{"boards_projects", "create", `created_by = @request.auth.id`,
			"bootstrap trusts created_by, so the caller must not name another user as creator"},
		{"boards_projects", "update", `(@request.body.created_by:isset = false || @request.body.created_by = created_by)`,
			"an owner must not hand an orphaned board's bootstrap branch to another user"},
	} {
		rule := shippedRule(t, env, c.collection, c.kind)
		if !strings.Contains(rule, c.clause) {
			t.Errorf("%s.%sRule lost %q (%s)\nrule: %s", c.collection, c.kind, c.clause, c.why, rule)
		}
	}
}

func shippedRule(t *testing.T, env *cardsEnv, collection, kind string) string {
	t.Helper()
	col, err := env.app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatalf("find %s: %v", collection, err)
	}
	var rule *string
	switch kind {
	case "create":
		rule = col.CreateRule
	case "update":
		rule = col.UpdateRule
	default:
		t.Fatalf("unsupported rule kind %q", kind)
	}
	if rule == nil {
		t.Fatalf("%s.%sRule is nil", collection, kind)
	}
	return *rule
}

func requireNoMembers(projectID string) func(testing.TB, *tests.TestApp) {
	return func(t testing.TB, app *tests.TestApp) {
		n, err := app.CountRecords("boards_project_members", dbx.HashExp{"project": projectID})
		if err != nil {
			t.Fatalf("count members: %v", err)
		}
		if n != 0 {
			t.Fatalf("project %s has %d member rows, want 0", projectID, n)
		}
	}
}
