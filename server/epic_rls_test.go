package boards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// boards_epics' own rules, and the same-board invariant on boards_cards.epic.
//
// The epic pin is the parent pin one collection over, and it protects the same
// thing: an editor who belongs to two boards could otherwise file a card on
// board A into an epic on board B, and A's members would see a chip naming an
// epic they cannot open while B's rollup counted points from a card nobody on
// B can read.
//
// pinEpicProject has three branches and each needs its own test:
//
//	(@request.body.epic:isset = false     -- an ordinary PATCH, no epic named
//	 || @request.body.epic = ""           -- clearing an epic
//	 || @request.body.epic.project = project)
//
// The collection's own rules are boards_labels': members read, writers write.

func cardsEpic(t *testing.T, app core.App, project *core.Record, title, position string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("boards_epics")
	if err != nil {
		t.Fatalf("find boards_epics: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("project", project.Id)
	r.Set("title", title)
	r.Set("position", position)
	if err := app.Save(r); err != nil {
		t.Fatalf("save epic %s: %v", title, err)
	}
	return r
}

func requireCardEpic(cardID, want string) func(t testing.TB, app *tests.TestApp) {
	return func(t testing.TB, app *tests.TestApp) {
		card, err := app.FindRecordById("boards_cards", cardID)
		if err != nil {
			t.Fatalf("reload card: %v", err)
		}
		if got := card.GetString("epic"); got != want {
			t.Fatalf("card epic = %q, want %q", got, want)
		}
	}
}

func TestCardsEpicRLS_EditorCanFileWithinTheBoard(t *testing.T) {
	env := setupCardsEnv(t)
	epic := cardsEpic(t, env.app, env.project, "Authentication", "a0")

	req{
		method:  http.MethodPatch,
		url:     "/api/collections/boards_cards/records/" + env.card.Id,
		token:   env.editorToken,
		body:    `{"epic":"` + epic.Id + `"}`,
		want:    http.StatusOK,
		content: []string{`"epic":"` + epic.Id + `"`},
	}.run(t, env)
}

// The refusal this file exists for. The stored value is asserted as well as
// the status, per requireCardProject's discipline: a status check alone would
// pass if PocketBase had written the row and then returned 404.
func TestCardsEpicRLS_EditorCannotFileOntoAnotherBoardsEpic(t *testing.T) {
	env := setupCardsEnv(t)

	// A second board the editor genuinely belongs to, so the refusal is the
	// PIN doing its work rather than a plain membership failure.
	other := cardsProject(t, env.app, "Other", env.owner)
	cardsMember(t, env.app, other, env.owner, "owner")
	cardsMember(t, env.app, other, env.editor, "editor")
	foreign := cardsEpic(t, env.app, other, "Their epic", "a0")

	req{
		method: http.MethodPatch,
		url:    "/api/collections/boards_cards/records/" + env.card.Id,
		token:  env.editorToken,
		body:   `{"epic":"` + foreign.Id + `"}`,
		want:   http.StatusNotFound,
		after:  requireCardEpic(env.card.Id, ""),
	}.run(t, env)
}

// The create path carries the same pin, and needs its own test: a rule that
// only pinned updates would let the very first write land cross-board.
func TestCardsEpicRLS_CannotCreateWithAForeignEpic(t *testing.T) {
	env := setupCardsEnv(t)

	other := cardsProject(t, env.app, "Other", env.owner)
	cardsMember(t, env.app, other, env.owner, "owner")
	cardsMember(t, env.app, other, env.editor, "editor")
	foreign := cardsEpic(t, env.app, other, "Their epic", "a0")

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_cards/records",
		token:  env.editorToken,
		body: `{"project":"` + env.project.Id + `","list":"` + env.list.Id +
			`","title":"smuggled","position":"a9","epic":"` + foreign.Id + `"}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

// The `= ""` branch: un-filing a card must stay expressible. Without it,
// clearing would have to satisfy `"".project = project` and could never pass.
func TestCardsEpicRLS_EditorCanClearAnEpic(t *testing.T) {
	env := setupCardsEnv(t)
	epic := cardsEpic(t, env.app, env.project, "Authentication", "a0")
	env.card.Set("epic", epic.Id)
	if err := env.app.Save(env.card); err != nil {
		t.Fatalf("seed epic: %v", err)
	}

	req{
		method:  http.MethodPatch,
		url:     "/api/collections/boards_cards/records/" + env.card.Id,
		token:   env.editorToken,
		body:    `{"epic":""}`,
		want:    http.StatusOK,
		content: []string{`"epic":""`},
		after:   requireCardEpic(env.card.Id, ""),
	}.run(t, env)
}

// The `:isset = false` branch: an edit that names no epic must be unaffected,
// which is trap 2's reason — a client echoing the whole record back must not
// be refused.
func TestCardsEpicRLS_AnEditWithoutEpicIsUnaffected(t *testing.T) {
	env := setupCardsEnv(t)
	epic := cardsEpic(t, env.app, env.project, "Authentication", "a0")
	env.card.Set("epic", epic.Id)
	if err := env.app.Save(env.card); err != nil {
		t.Fatalf("seed epic: %v", err)
	}

	req{
		method:  http.MethodPatch,
		url:     "/api/collections/boards_cards/records/" + env.card.Id,
		token:   env.editorToken,
		body:    `{"title":"renamed"}`,
		want:    http.StatusOK,
		content: []string{`"title":"renamed"`},
		after:   requireCardEpic(env.card.Id, epic.Id),
	}.run(t, env)
}

// Filing a card is a write to the card, so the write roles govern it.
func TestCardsEpicRLS_CommentorCannotFile(t *testing.T) {
	env := setupCardsEnv(t)
	epic := cardsEpic(t, env.app, env.project, "Authentication", "a0")

	req{
		method: http.MethodPatch,
		url:    "/api/collections/boards_cards/records/" + env.card.Id,
		token:  env.commentorToken,
		body:   `{"epic":"` + epic.Id + `"}`,
		want:   http.StatusNotFound,
		after:  requireCardEpic(env.card.Id, ""),
	}.run(t, env)
}

// The collection's own rules — boards_labels': members read, writers write.

func TestCardsEpicRLS_ViewerReadsAnEpic(t *testing.T) {
	env := setupCardsEnv(t)
	epic := cardsEpic(t, env.app, env.project, "Authentication", "a0")

	req{
		method:  http.MethodGet,
		url:     "/api/collections/boards_epics/records/" + epic.Id,
		token:   env.viewerToken,
		want:    http.StatusOK,
		content: []string{`"title":"Authentication"`},
	}.run(t, env)
}

func TestCardsEpicRLS_EditorCreatesAnEpic(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method:  http.MethodPost,
		url:     "/api/collections/boards_epics/records",
		token:   env.editorToken,
		body:    `{"project":"` + env.project.Id + `","title":"Billing","position":"a1"}`,
		want:    http.StatusOK,
		content: []string{`"title":"Billing"`},
	}.run(t, env)
}

// A viewer reads but does not write — the boards_labels split.
func TestCardsEpicRLS_ViewerCannotCreateAnEpic(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_epics/records",
		token:  env.viewerToken,
		body:   `{"project":"` + env.project.Id + `","title":"Nope","position":"a2"}`,
		want:   http.StatusBadRequest,
	}.run(t, env)
}

func TestCardsEpicRLS_OutsiderReadsNothing(t *testing.T) {
	env := setupCardsEnv(t)
	epic := cardsEpic(t, env.app, env.project, "Authentication", "a0")

	req{
		method: http.MethodGet,
		url:    "/api/collections/boards_epics/records/" + epic.Id,
		token:  env.outsiderToken,
		want:   http.StatusNotFound,
	}.run(t, env)
}

// The anti-repoint pin: an epic cannot be moved to another board, which would
// carry every card filed under it out of view.
func TestCardsEpicRLS_CannotRepointAnEpicToAnotherBoard(t *testing.T) {
	env := setupCardsEnv(t)
	epic := cardsEpic(t, env.app, env.project, "Authentication", "a0")

	other := cardsProject(t, env.app, "Other", env.owner)
	cardsMember(t, env.app, other, env.owner, "owner")
	cardsMember(t, env.app, other, env.editor, "editor")

	req{
		method: http.MethodPatch,
		url:    "/api/collections/boards_epics/records/" + epic.Id,
		token:  env.editorToken,
		body:   `{"project":"` + other.Id + `"}`,
		want:   http.StatusNotFound,
	}.run(t, env)
}
