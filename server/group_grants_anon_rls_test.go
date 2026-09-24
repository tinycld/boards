package boards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/rlstest"
)

// Anonymous callers and group grants.
//
// A grant row on boards_project_members stores user "". With no login,
// PocketBase resolves @request.auth.id to NULL and rewrites `x = NULL` as
// `(x = '' OR x IS NULL)`, so `…_via_project.user ?= @request.auth.id`
// matches the grant and a caller with no token would get the grant's role on
// the whole board. Every rule that reaches boards_project_members.user must
// therefore also require `@request.auth.id != ""`.
//
// Each test seeds an EDITOR grant (the strongest role a group can hold) plus
// one row in every collection a member reads, and sends no token.

type anonBoardEnv struct {
	*cardsEnv
	grant *core.Record
	rows  map[string]*core.Record
}

func seedRow(t *testing.T, app core.App, collection string, fields map[string]any) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatalf("find %s: %v", collection, err)
	}
	r := core.NewRecord(col)
	for k, v := range fields {
		r.Set(k, v)
	}
	if err := app.Save(r); err != nil {
		t.Fatalf("seed %s: %v", collection, err)
	}
	return r
}

func setupAnonBoardEnv(t *testing.T) *anonBoardEnv {
	t.Helper()
	env := setupCardsEnv(t)
	app := env.app
	g := cardsGroup(t, app, "keepers")
	grant := cardsGroupGrant(t, app, env.project, g, "editor")

	project := env.project.Id
	card := env.card.Id
	other := cardsCard(t, app, env.project, env.list, "other-card", "a1", env.owner)
	comment := cardsComment(t, app, env.project, env.card, env.owner, "hello")
	sprint := seedRow(t, app, "boards_sprints", map[string]any{"project": project, "number": 1, "state": "planned"})

	rows := map[string]*core.Record{
		"boards_projects":        env.project,
		"boards_project_members": grant,
		"boards_lists":           env.list,
		"boards_cards":           env.card,
		"boards_comments":        comment,
		"boards_sprints":         sprint,
		"boards_labels":          cardsLabel(t, app, env.project, "bug", "red"),
		"boards_checklist_items": cardsChecklistItem(t, app, env.project, env.card, "step", "a0"),
		"boards_attachments":     cardsAttachment(t, app, env.project, env.card, env.owner, "a.txt"),
		"boards_activity":        seedActivityRow(t, app, env),
		"boards_share_links": seedRow(t, app, "boards_share_links", map[string]any{
			"project": project, "token": longToken, "role": "viewer", "created_by": env.owner.Id, "is_active": true,
		}),
		"boards_card_watchers": seedRow(t, app, "boards_card_watchers", map[string]any{
			"project": project, "card": card, "user": env.owner.Id,
		}),
		"boards_comment_reactions": seedRow(t, app, "boards_comment_reactions", map[string]any{
			"project": project, "card": card, "comment": comment.Id, "user": env.owner.Id, "emoji": "👍",
		}),
		"boards_card_reactions": seedRow(t, app, "boards_card_reactions", map[string]any{
			"project": project, "card": card, "user": env.owner.Id, "emoji": "👍",
		}),
		"boards_card_links": seedRow(t, app, "boards_card_links", map[string]any{
			"source": card, "target": other.Id, "type": "related",
		}),
		"boards_epics": seedRow(t, app, "boards_epics", map[string]any{"project": project, "title": "epic"}),
		"boards_sprint_snapshots": seedRow(t, app, "boards_sprint_snapshots", map[string]any{
			"sprint": sprint.Id, "project": project, "day": "2026-09-24 00:00:00.000Z",
		}),
		"boards_project_repos": seedRow(t, app, "boards_project_repos", map[string]any{
			"project": project, "repo": "acme/widgets",
		}),
		"boards_pr_links": seedRow(t, app, "boards_pr_links", map[string]any{
			"card": card, "project": project, "repo": "acme/widgets", "number": 7, "state": "open", "link_source": "manual",
		}),
	}
	return &anonBoardEnv{cardsEnv: env, grant: grant, rows: rows}
}

func collectionURL(collection string) string {
	return "/api/collections/" + collection + "/records"
}

// requireStillThere proves a refused write left the row alone, and — for the
// read sweeps — that the empty result came from the rule, not from a fixture
// that failed to land.
func requireStillThere(collection, id string) func(testing.TB, *tests.TestApp) {
	return func(t testing.TB, app *tests.TestApp) {
		t.Helper()
		if _, err := app.FindRecordById(collection, id); err != nil {
			t.Fatalf("%s row %s is gone: %v", collection, id, err)
		}
	}
}

// One fresh env per case: ApiScenario.Test re-triggers OnServe, and a second
// scenario on the same app panics on duplicate route registration.
var anonReadCollections = []string{
	"boards_projects", "boards_project_members", "boards_share_links",
	"boards_labels", "boards_lists", "boards_cards", "boards_checklist_items",
	"boards_comments", "boards_attachments", "boards_activity",
	"boards_card_watchers", "boards_comment_reactions", "boards_card_reactions",
	"boards_card_links", "boards_epics", "boards_sprints",
	"boards_sprint_snapshots", "boards_project_repos", "boards_pr_links",
}

func TestGroupGrantAnon_CannotListAnyCollection(t *testing.T) {
	for _, collection := range anonReadCollections {
		t.Run(collection, func(t *testing.T) {
			env := setupAnonBoardEnv(t)
			req{
				method:  http.MethodGet,
				url:     collectionURL(collection),
				want:    http.StatusOK,
				content: []string{`"totalItems":0`},
				after:   requireStillThere(collection, env.rows[collection].Id),
			}.run(t, env.cardsEnv)
		})
	}
}

func TestGroupGrantAnon_CannotViewAnyRow(t *testing.T) {
	for _, collection := range anonReadCollections {
		t.Run(collection, func(t *testing.T) {
			env := setupAnonBoardEnv(t)
			req{
				method: http.MethodGet,
				url:    collectionURL(collection) + "/" + env.rows[collection].Id,
				want:   http.StatusNotFound,
			}.run(t, env.cardsEnv)
		})
	}
}

// Positive control for the sweeps: the owner lists every seeded row, so each
// empty anonymous list above is the rule's doing.
func TestGroupGrantAnon_OwnerListsEveryCollection(t *testing.T) {
	for _, collection := range anonReadCollections {
		t.Run(collection, func(t *testing.T) {
			env := setupAnonBoardEnv(t)
			req{
				method:     http.MethodGet,
				url:        collectionURL(collection),
				token:      env.ownerToken,
				want:       http.StatusOK,
				content:    []string{env.rows[collection].Id},
				notContent: []string{`"totalItems":0`},
			}.run(t, env.cardsEnv)
		})
	}
}

// The writes an editor grant allows, which an anonymous caller must not reach.
func TestGroupGrantAnon_CannotWrite(t *testing.T) {
	cases := []struct {
		name       string
		method     string
		collection string
		row        bool
		body       func(*anonBoardEnv) string
		want       int
	}{
		{"rename card", http.MethodPatch, "boards_cards", true,
			func(*anonBoardEnv) string { return `{"title":"renamed-anonymously"}` }, http.StatusNotFound},
		{"delete card", http.MethodDelete, "boards_cards", true, nil, http.StatusNotFound},
		{"create card", http.MethodPost, "boards_cards", false, func(e *anonBoardEnv) string {
			return `{"project":"` + e.project.Id + `","list":"` + e.list.Id + `","title":"anon","position":"b0","created_by":"` + e.owner.Id + `"}`
		}, http.StatusBadRequest},
		{"create list", http.MethodPost, "boards_lists", false, func(e *anonBoardEnv) string {
			return `{"project":"` + e.project.Id + `","name":"anon","position":"b0"}`
		}, http.StatusBadRequest},
		{"rename list", http.MethodPatch, "boards_lists", true,
			func(*anonBoardEnv) string { return `{"name":"renamed-anonymously"}` }, http.StatusNotFound},
		{"delete label", http.MethodDelete, "boards_labels", true, nil, http.StatusNotFound},
		{"delete checklist item", http.MethodDelete, "boards_checklist_items", true, nil, http.StatusNotFound},
		{"delete epic", http.MethodDelete, "boards_epics", true, nil, http.StatusNotFound},
		{"delete sprint", http.MethodDelete, "boards_sprints", true, nil, http.StatusNotFound},
		{"delete card link", http.MethodDelete, "boards_card_links", true, nil, http.StatusNotFound},
		{"delete grant", http.MethodDelete, "boards_project_members", true, nil, http.StatusNotFound},
		{"re-role grant", http.MethodPatch, "boards_project_members", true,
			func(*anonBoardEnv) string { return `{"role":"viewer"}` }, http.StatusNotFound},
		{"rename project", http.MethodPatch, "boards_projects", true,
			func(*anonBoardEnv) string { return `{"name":"renamed-anonymously"}` }, http.StatusNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			env := setupAnonBoardEnv(t)
			url := collectionURL(c.collection)
			var after func(testing.TB, *tests.TestApp)
			if c.row {
				id := env.rows[c.collection].Id
				url += "/" + id
				after = requireStillThere(c.collection, id)
			}
			body := ""
			if c.body != nil {
				body = c.body(env)
			}
			req{method: c.method, url: url, body: body, want: c.want, after: after}.run(t, env.cardsEnv)
		})
	}
}

// Positive control for the write cases: the same card rename from a member
// holding the editor role succeeds, so the refusal above is the rule's.
func TestGroupGrantAnon_EditorMayRenameCard(t *testing.T) {
	env := setupAnonBoardEnv(t)
	req{
		method:  http.MethodPatch,
		url:     collectionURL("boards_cards") + "/" + env.card.Id,
		token:   env.editorToken,
		body:    `{"title":"renamed-by-editor"}`,
		want:    http.StatusOK,
		content: []string{`"title":"renamed-by-editor"`},
	}.run(t, env.cardsEnv)
}

// Every rule in the app that reaches boards_project_members.user must carry
// the login guard. This catches a future rule the sweeps above do not name.
func TestGroupGrantAnon_EveryGrantRuleRequiresLogin(t *testing.T) {
	app := newCardsApp(t)
	rlstest.RequireAuthGuardOnGrantRules(t, app, "boards_project_members")
}
