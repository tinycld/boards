package boards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// The three row kinds on boards_project_members, through the API as the
// project owner:
//   - grant (group set, user empty): owner may create, re-role, delete; never owner role
//   - derived (both set): owner may not create, update or delete
//   - direct: unchanged behaviour (covered elsewhere)
// Derived rows still satisfy the roster and content rules, so a group member
// reads the project like a direct member.
//
// One ApiScenario (== one top-level Test func with a fresh env) per case, per
// the package convention in rls_setup_test.go: ApiScenario.Test re-triggers
// OnServe, and two scenarios against the SAME app panic on duplicate route
// registration — so a single env/app must not back more than one req.run.

func TestGroupGrantRules_OwnerCreatesAViewerGrant(t *testing.T) {
	env := setupCardsEnv(t)
	g := cardsGroup(t, env.app, "keepers")

	req{
		method:  http.MethodPost,
		url:     "/api/collections/boards_project_members/records",
		token:   env.ownerToken,
		body:    `{"project":"` + env.project.Id + `","group":"` + g.Id + `","role":"viewer"}`,
		want:    http.StatusOK,
		content: []string{`"group":"` + g.Id + `"`, `"user":""`},
	}.run(t, env)
}

func TestGroupGrantRules_OwnerMayNotGrantOwnerRoleToAGroup(t *testing.T) {
	env := setupCardsEnv(t)
	g := cardsGroup(t, env.app, "keepers")

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_project_members/records",
		token:  env.ownerToken,
		body:   `{"project":"` + env.project.Id + `","group":"` + g.Id + `","role":"owner"}`,
		want:   http.StatusBadRequest,
	}.run(t, env)
}

func TestGroupGrantRules_NobodyMayCreateADerivedRowThroughTheAPI(t *testing.T) {
	env := setupCardsEnv(t)
	g := cardsGroup(t, env.app, "keepers")

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_project_members/records",
		token:  env.ownerToken,
		body:   `{"project":"` + env.project.Id + `","group":"` + g.Id + `","user":"` + env.outsider.Id + `","role":"viewer"}`,
		want:   http.StatusBadRequest,
	}.run(t, env)
}

func TestGroupGrantRules_DerivedRowIsReadByItsUserAndUntouchableByTheOwner(t *testing.T) {
	env := setupCardsEnv(t)
	g := cardsGroup(t, env.app, "keepers")

	// Written as core would: superuser context, both fields set.
	col, err := env.app.FindCollectionByNameOrId("boards_project_members")
	if err != nil {
		t.Fatalf("find boards_project_members: %v", err)
	}
	derived := core.NewRecord(col)
	derived.Set("project", env.project.Id)
	derived.Set("group", g.Id)
	derived.Set("user", env.outsider.Id)
	derived.Set("role", "viewer")
	if err := env.app.Save(derived); err != nil {
		t.Fatalf("save derived: %v", err)
	}

	req{
		method:  http.MethodGet,
		url:     "/api/collections/boards_projects/records/" + env.project.Id,
		token:   env.outsiderToken,
		want:    http.StatusOK,
		content: []string{env.project.Id},
	}.run(t, env)
}

func TestGroupGrantRules_OwnerCannotUpdateADerivedRow(t *testing.T) {
	env := setupCardsEnv(t)
	g := cardsGroup(t, env.app, "keepers")

	col, err := env.app.FindCollectionByNameOrId("boards_project_members")
	if err != nil {
		t.Fatalf("find boards_project_members: %v", err)
	}
	derived := core.NewRecord(col)
	derived.Set("project", env.project.Id)
	derived.Set("group", g.Id)
	derived.Set("user", env.outsider.Id)
	derived.Set("role", "viewer")
	if err := env.app.Save(derived); err != nil {
		t.Fatalf("save derived: %v", err)
	}

	req{
		method: http.MethodPatch,
		url:    "/api/collections/boards_project_members/records/" + derived.Id,
		token:  env.ownerToken,
		body:   `{"role":"editor"}`,
		want:   http.StatusNotFound,
	}.run(t, env)
}

func TestGroupGrantRules_OwnerCannotDeleteADerivedRow(t *testing.T) {
	env := setupCardsEnv(t)
	g := cardsGroup(t, env.app, "keepers")

	col, err := env.app.FindCollectionByNameOrId("boards_project_members")
	if err != nil {
		t.Fatalf("find boards_project_members: %v", err)
	}
	derived := core.NewRecord(col)
	derived.Set("project", env.project.Id)
	derived.Set("group", g.Id)
	derived.Set("user", env.outsider.Id)
	derived.Set("role", "viewer")
	if err := env.app.Save(derived); err != nil {
		t.Fatalf("save derived: %v", err)
	}

	req{
		method: http.MethodDelete,
		url:    "/api/collections/boards_project_members/records/" + derived.Id,
		token:  env.ownerToken,
		want:   http.StatusNotFound,
	}.run(t, env)
}
