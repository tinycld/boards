package boards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// boards_activity access: members read, share-link visitors read, nobody
// writes through the API. No hooks bound — this measures the shipped rules.

func seedActivityRow(t *testing.T, app core.App, env *cardsEnv) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("boards_activity")
	if err != nil {
		t.Fatal(err)
	}
	row := core.NewRecord(col)
	row.Set("project", env.project.Id)
	row.Set("card", env.card.Id)
	row.Set("actor", env.owner.Id)
	row.Set("kind", "created")
	if err := app.Save(row); err != nil {
		t.Fatalf("seed activity: %v", err)
	}
	return row
}

func TestActivityRLS_ViewerCanList(t *testing.T) {
	env := setupCardsEnv(t)
	seedActivityRow(t, env.app, env)
	req{
		method:  http.MethodGet,
		url:     "/api/collections/boards_activity/records",
		token:   env.viewerToken,
		want:    http.StatusOK,
		content: []string{`"totalItems":1`, `"kind":"created"`},
	}.run(t, env)
}

func TestActivityRLS_OutsiderSeesNothing(t *testing.T) {
	env := setupCardsEnv(t)
	seedActivityRow(t, env.app, env)
	req{
		method:  http.MethodGet,
		url:     "/api/collections/boards_activity/records",
		token:   env.outsiderToken,
		want:    http.StatusOK,
		content: []string{`"totalItems":0`},
	}.run(t, env)
}

func TestActivityRLS_ClientCannotCreate(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_activity/records",
		token:  env.ownerToken,
		body: `{"project":"` + env.project.Id + `","card":"` + env.card.Id +
			`","actor":"` + env.owner.Id + `","kind":"created"}`,
		// A collection with no create rule is superuser-only, and PocketBase
		// answers a member's attempt with 403 rather than the 400 a failed
		// rule yields — the refusal is categorical, not a rule miss.
		want: http.StatusForbidden,
	}.run(t, env)
}

// One request per test: the harness serves the app afresh for each
// ApiScenario, and a second run in the same test re-registers its routes.
func TestActivityRLS_ClientCannotUpdate(t *testing.T) {
	env := setupCardsEnv(t)
	row := seedActivityRow(t, env.app, env)
	req{
		method: http.MethodPatch,
		url:    "/api/collections/boards_activity/records/" + row.Id,
		token:  env.ownerToken,
		body:   `{"kind":"moved"}`,
		// Superuser-only, so 403 (see ClientCannotCreate).
		want: http.StatusForbidden,
	}.run(t, env)
}

func TestActivityRLS_ClientCannotDelete(t *testing.T) {
	env := setupCardsEnv(t)
	row := seedActivityRow(t, env.app, env)
	req{
		method: http.MethodDelete,
		url:    "/api/collections/boards_activity/records/" + row.Id,
		token:  env.ownerToken,
		want:   http.StatusForbidden,
	}.run(t, env)
}
