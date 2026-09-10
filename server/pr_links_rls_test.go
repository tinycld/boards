package boards

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// boards_pr_links / boards_project_repos access.
//
// Both collections resolve ONE project, unlike boards_card_links' two — so the
// interesting axis here is not which end is doing the work but WHO may write.
// boards_pr_links is server-written for the webhook path (which runs as a
// superuser and never touches these rules at all); what the rules govern is
// the client path — a member linking a PR by URL, and unlinking one — so the
// write surface is deliberately narrower than "any member": owner|editor,
// matching boards_cards' own updateRule. boards_project_repos narrows further
// still, to owner alone, because attaching a repo hands the board's PR chips
// to a webhook installation and that is not a call an editor should make
// unilaterally.
//
// prLinkBody's url MUST be a real, well-formed URL: boards_pr_links.url is a
// PocketBase url-type field, and PocketBase rejects a body that fails field
// validation before the rule ever runs — a placeholder would make a create
// case fail closed for the wrong reason and pass while proving nothing.

func prLinkBody(card, project, repo string, number int) string {
	n := strconv.Itoa(number)
	return `{"card":"` + card + `","project":"` + project + `",` +
		`"repo":"` + repo + `","number":` + n + `,` +
		`"url":"https://github.com/o/r/pull/` + n + `",` +
		`"state":"open","link_source":"manual"}`
}

// seedPRLink writes a link directly, for the read/update/delete cases —
// bypassing the create rule on purpose, so those cases cannot silently depend
// on a write passing.
func seedPRLink(t *testing.T, env *cardsEnv, card, project, repo string, number int) *core.Record {
	t.Helper()
	col, err := env.app.FindCollectionByNameOrId("boards_pr_links")
	if err != nil {
		t.Fatalf("find boards_pr_links: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("card", card)
	r.Set("project", project)
	r.Set("repo", repo)
	r.Set("number", number)
	r.Set("url", "https://github.com/o/r/pull/"+strconv.Itoa(number))
	r.Set("state", "open")
	r.Set("link_source", "manual")
	if err := env.app.Save(r); err != nil {
		t.Fatalf("seed pr link: %v", err)
	}
	return r
}

// --- non-member -------------------------------------------------------------

func TestPRLinksRLS_NonMemberCannotList(t *testing.T) {
	env := setupCardsEnv(t)
	seedPRLink(t, env, env.card.Id, env.project.Id, "o/r", 1)

	req{
		method:  http.MethodGet,
		url:     "/api/collections/boards_pr_links/records",
		token:   env.outsiderToken,
		want:    http.StatusOK,
		content: []string{`"totalItems":0`},
	}.run(t, env)
}

func TestPRLinksRLS_NonMemberCannotView(t *testing.T) {
	env := setupCardsEnv(t)
	link := seedPRLink(t, env, env.card.Id, env.project.Id, "o/r", 1)

	req{
		method: http.MethodGet,
		url:    "/api/collections/boards_pr_links/records/" + link.Id,
		token:  env.outsiderToken,
		want:   http.StatusNotFound,
	}.run(t, env)
}

func TestPRLinksRLS_NonMemberCannotCreate(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_pr_links/records",
		token:  env.outsiderToken,
		body:   prLinkBody(env.card.Id, env.project.Id, "o/r", 2),
		want:   http.StatusBadRequest,
		after:  requirePRLinkCountAfter(env, env.card.Id, 0),
	}.run(t, env)
}

func TestPRLinksRLS_NonMemberCannotUpdate(t *testing.T) {
	env := setupCardsEnv(t)
	link := seedPRLink(t, env, env.card.Id, env.project.Id, "o/r", 3)

	req{
		method: http.MethodPatch,
		url:    "/api/collections/boards_pr_links/records/" + link.Id,
		token:  env.outsiderToken,
		body:   `{"state":"merged"}`,
		want:   http.StatusNotFound,
	}.run(t, env)
}

func TestPRLinksRLS_NonMemberCannotDelete(t *testing.T) {
	env := setupCardsEnv(t)
	link := seedPRLink(t, env, env.card.Id, env.project.Id, "o/r", 4)

	req{
		method: http.MethodDelete,
		url:    "/api/collections/boards_pr_links/records/" + link.Id,
		token:  env.outsiderToken,
		want:   http.StatusNotFound,
	}.run(t, env)
}

// --- viewer -------------------------------------------------------------

func TestPRLinksRLS_ViewerCanList(t *testing.T) {
	env := setupCardsEnv(t)
	link := seedPRLink(t, env, env.card.Id, env.project.Id, "o/r", 5)

	req{
		method:  http.MethodGet,
		url:     "/api/collections/boards_pr_links/records",
		token:   env.viewerToken,
		want:    http.StatusOK,
		content: []string{`"totalItems":1`, link.Id},
	}.run(t, env)
}

func TestPRLinksRLS_ViewerCanView(t *testing.T) {
	env := setupCardsEnv(t)
	link := seedPRLink(t, env, env.card.Id, env.project.Id, "o/r", 6)

	req{
		method:  http.MethodGet,
		url:     "/api/collections/boards_pr_links/records/" + link.Id,
		token:   env.viewerToken,
		want:    http.StatusOK,
		content: []string{link.Id},
	}.run(t, env)
}

func TestPRLinksRLS_ViewerCannotCreate(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_pr_links/records",
		token:  env.viewerToken,
		body:   prLinkBody(env.card.Id, env.project.Id, "o/r", 7),
		want:   http.StatusBadRequest,
		after:  requirePRLinkCountAfter(env, env.card.Id, 0),
	}.run(t, env)
}

func TestPRLinksRLS_ViewerCannotUpdate(t *testing.T) {
	env := setupCardsEnv(t)
	link := seedPRLink(t, env, env.card.Id, env.project.Id, "o/r", 8)

	req{
		method: http.MethodPatch,
		url:    "/api/collections/boards_pr_links/records/" + link.Id,
		token:  env.viewerToken,
		body:   `{"state":"merged"}`,
		want:   http.StatusNotFound,
		after:  requirePRLinkState(link.Id, "open"),
	}.run(t, env)
}

func TestPRLinksRLS_ViewerCannotDelete(t *testing.T) {
	env := setupCardsEnv(t)
	link := seedPRLink(t, env, env.card.Id, env.project.Id, "o/r", 9)

	req{
		method: http.MethodDelete,
		url:    "/api/collections/boards_pr_links/records/" + link.Id,
		token:  env.viewerToken,
		want:   http.StatusNotFound,
		after:  requirePRLinkExists(link.Id),
	}.run(t, env)
}

// --- editor -------------------------------------------------------------

func TestPRLinksRLS_EditorCanCreate(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method:  http.MethodPost,
		url:     "/api/collections/boards_pr_links/records",
		token:   env.editorToken,
		body:    prLinkBody(env.card.Id, env.project.Id, "o/r", 10),
		want:    http.StatusOK,
		content: []string{`"repo":"o/r"`},
		after:   requirePRLinkCountAfter(env, env.card.Id, 1),
	}.run(t, env)
}

func TestPRLinksRLS_EditorCanUpdate(t *testing.T) {
	env := setupCardsEnv(t)
	link := seedPRLink(t, env, env.card.Id, env.project.Id, "o/r", 11)

	req{
		method:  http.MethodPatch,
		url:     "/api/collections/boards_pr_links/records/" + link.Id,
		token:   env.editorToken,
		body:    `{"state":"merged"}`,
		want:    http.StatusOK,
		content: []string{`"state":"merged"`},
	}.run(t, env)
}

func TestPRLinksRLS_EditorCanDelete(t *testing.T) {
	env := setupCardsEnv(t)
	link := seedPRLink(t, env, env.card.Id, env.project.Id, "o/r", 12)

	req{
		method: http.MethodDelete,
		url:    "/api/collections/boards_pr_links/records/" + link.Id,
		token:  env.editorToken,
		want:   http.StatusNoContent,
	}.run(t, env)
}

// --- commentor: the write surface is owner|editor, not commentor -----------

func TestPRLinksRLS_CommentorCannotCreate(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_pr_links/records",
		token:  env.commentorToken,
		body:   prLinkBody(env.card.Id, env.project.Id, "o/r", 13),
		want:   http.StatusBadRequest,
		after:  requirePRLinkCountAfter(env, env.card.Id, 0),
	}.run(t, env)
}

// --- the anti-desync pin -----------------------------------------------

// A create whose `project` does not match `card.project` must be refused —
// otherwise a writer on project A could file a link naming a card on A but
// stamp `project` as B, and the row would resolve as B's for every rule that
// reads it while its card stays unreadable to B's members (1980000021's
// header: `project` is denormalized precisely so this pin can be one clause).
func TestPRLinksRLS_AntiDesyncPinRefusesMismatchedProject(t *testing.T) {
	env := setupCardsEnv(t)
	other := cardsProject(t, env.app, "Other", env.owner)
	cardsMember(t, env.app, other, env.editor, "editor")

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_pr_links/records",
		token:  env.editorToken,
		body:   prLinkBody(env.card.Id, other.Id, "o/r", 14),
		want:   http.StatusBadRequest,
		after:  requirePRLinkCountAfter(env, env.card.Id, 0),
	}.run(t, env)
}

// --- boards_project_repos ------------------------------------------------

func repoBody(project, repo string) string {
	return `{"project":"` + project + `","repo":"` + repo + `"}`
}

func TestProjectReposRLS_NonMemberCannotCreate(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_project_repos/records",
		token:  env.outsiderToken,
		body:   repoBody(env.project.Id, "o/r"),
		want:   http.StatusBadRequest,
	}.run(t, env)
}

func TestProjectReposRLS_ViewerCanRead(t *testing.T) {
	env := setupCardsEnv(t)
	repo := attachRepoRow(t, env, env.project.Id, "o/r")

	req{
		method:  http.MethodGet,
		url:     "/api/collections/boards_project_repos/records",
		token:   env.viewerToken,
		want:    http.StatusOK,
		content: []string{`"totalItems":1`, repo.Id},
	}.run(t, env)
}

func TestProjectReposRLS_ViewerCannotCreate(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_project_repos/records",
		token:  env.viewerToken,
		body:   repoBody(env.project.Id, "o/r"),
		want:   http.StatusBadRequest,
	}.run(t, env)
}

// The write surface is owner alone — narrower than boards_pr_links'
// owner|editor — because attaching a repo hands the board's PR chips to a
// webhook installation, which is a standing decision rather than day-to-day
// card work.
func TestProjectReposRLS_EditorCannotCreate(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_project_repos/records",
		token:  env.editorToken,
		body:   repoBody(env.project.Id, "o/r"),
		want:   http.StatusBadRequest,
	}.run(t, env)
}

func TestProjectReposRLS_OwnerCanCreate(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method:  http.MethodPost,
		url:     "/api/collections/boards_project_repos/records",
		token:   env.ownerToken,
		body:    repoBody(env.project.Id, "o/r"),
		want:    http.StatusOK,
		content: []string{`"repo":"o/r"`},
	}.run(t, env)
}

func TestProjectReposRLS_OwnerCanUpdate(t *testing.T) {
	env := setupCardsEnv(t)
	repo := attachRepoRow(t, env, env.project.Id, "o/r")

	req{
		method:  http.MethodPatch,
		url:     "/api/collections/boards_project_repos/records/" + repo.Id,
		token:   env.ownerToken,
		body:    `{"installation_id":"12345"}`,
		want:    http.StatusOK,
		content: []string{`"installation_id":"12345"`},
	}.run(t, env)
}

func TestProjectReposRLS_OwnerCanDelete(t *testing.T) {
	env := setupCardsEnv(t)
	repo := attachRepoRow(t, env, env.project.Id, "o/r")

	req{
		method: http.MethodDelete,
		url:    "/api/collections/boards_project_repos/records/" + repo.Id,
		token:  env.ownerToken,
		want:   http.StatusNoContent,
	}.run(t, env)
}

// attachRepoRow is the RLS-suite twin of github_links_test.go's attachRepo —
// same shape, but returns the record so read/update/delete cases have an ID
// and a row to assert against.
func attachRepoRow(t *testing.T, env *cardsEnv, projectID, repo string) *core.Record {
	t.Helper()
	col, err := env.app.FindCollectionByNameOrId("boards_project_repos")
	if err != nil {
		t.Fatalf("find boards_project_repos: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("project", projectID)
	r.Set("repo", repo)
	if err := env.app.Save(r); err != nil {
		t.Fatalf("attaching %s: %v", repo, err)
	}
	return r
}

func requirePRLinkCountAfter(env *cardsEnv, cardID string, want int) func(t testing.TB, app *tests.TestApp) {
	return func(t testing.TB, app *tests.TestApp) {
		links, err := app.FindRecordsByFilter(
			"boards_pr_links", "card = {:card}", "", 0, 0,
			map[string]any{"card": cardID},
		)
		if err != nil {
			t.Fatalf("finding links: %v", err)
		}
		if len(links) != want {
			t.Fatalf("boards_pr_links rows for card %s = %d, want %d", cardID, len(links), want)
		}
	}
}

func requirePRLinkState(linkID, want string) func(t testing.TB, app *tests.TestApp) {
	return func(t testing.TB, app *tests.TestApp) {
		row, err := app.FindRecordById("boards_pr_links", linkID)
		if err != nil {
			t.Fatalf("reload link: %v", err)
		}
		if got := row.GetString("state"); got != want {
			t.Fatalf("link state = %q, want %q", got, want)
		}
	}
}

func requirePRLinkExists(linkID string) func(t testing.TB, app *tests.TestApp) {
	return func(t testing.TB, app *tests.TestApp) {
		if _, err := app.FindRecordById("boards_pr_links", linkID); err != nil {
			t.Fatalf("link was deleted by a caller that should not have been able to: %v", err)
		}
	}
}
