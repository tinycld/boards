package cards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

// The same-board invariant on cards_cards.parent.
//
// A sub-task may only ever name a card on ITS OWN board. This is the pin that
// makes everything downstream safe: the rollup cannot count a card the viewer
// is unable to read, the Go recount never spans projects, and the board query
// — which filters by `project` — always holds both ends of the relation.
//
// The attack is the anti-repoint one from 1980000000's trap 2, one hop out. An
// editor on board A who also belongs to board B can legitimately write a card
// on A; without the pin they could set its `parent` to a card on B, and A's
// members would then see a sub-task chip pointing at a card they cannot open,
// while B's card counted a child nobody on B can see.
//
// pinParentProject has three branches and each needs its own test:
//
//	(@request.body.parent:isset = false     -- an ordinary PATCH, no parent named
//	 || @request.body.parent = ""           -- clearing a parent
//	 || @request.body.parent.project = project)
//
// Cycle and depth are NOT here: a rule sees one row and cannot walk a chain, so
// those live in server/card_parent.go and are tested in parent_guard_test.go.

func TestCardsParentRLS_EditorCanParentWithinTheBoard(t *testing.T) {
	env := setupCardsEnv(t)
	child := cardsCard(t, env.app, env.project, env.list, "child", "a1", env.owner)

	req{
		method:  http.MethodPatch,
		url:     "/api/collections/cards_cards/records/" + child.Id,
		token:   env.editorToken,
		body:    `{"parent":"` + env.card.Id + `"}`,
		want:    http.StatusOK,
		content: []string{`"parent":"` + env.card.Id + `"`},
	}.run(t, env)
}

// The refusal this file exists for. The stored value is asserted as well as the
// status: a status check alone would pass if PocketBase had written the row and
// then returned 404 — the discipline requireCardProject documents.
func TestCardsParentRLS_EditorCannotParentOntoAnotherBoard(t *testing.T) {
	env := setupCardsEnv(t)

	// A second board the editor genuinely belongs to, so the refusal is the
	// PIN doing its work rather than a plain membership failure.
	other := cardsProject(t, env.app, "Other", env.owner)
	cardsMember(t, env.app, other, env.owner, "owner")
	cardsMember(t, env.app, other, env.editor, "editor")
	otherList := cardsList(t, env.app, other, "To do", "a0")
	foreign := cardsCard(t, env.app, other, otherList, "foreign", "a0", env.owner)

	req{
		method: http.MethodPatch,
		url:    "/api/collections/cards_cards/records/" + env.card.Id,
		token:  env.editorToken,
		body:   `{"parent":"` + foreign.Id + `"}`,
		want:   http.StatusNotFound,
		after:  requireCardParent(env.card.Id, ""),
	}.run(t, env)
}

// The create path carries the same pin, and needs its own test: a rule that
// only pinned updates would let the very first write land cross-board.
func TestCardsParentRLS_CannotCreateWithAForeignParent(t *testing.T) {
	env := setupCardsEnv(t)

	other := cardsProject(t, env.app, "Other", env.owner)
	cardsMember(t, env.app, other, env.owner, "owner")
	cardsMember(t, env.app, other, env.editor, "editor")
	otherList := cardsList(t, env.app, other, "To do", "a0")
	foreign := cardsCard(t, env.app, other, otherList, "foreign", "a0", env.owner)

	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_cards/records",
		token:  env.editorToken,
		body: `{"project":"` + env.project.Id + `","list":"` + env.list.Id +
			`","title":"smuggled","position":"a9","parent":"` + foreign.Id + `"}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

// The `= ""` branch. Without it, un-parenting would have to satisfy
// `"".project = project` and could never be expressed — a card would be stuck
// as a sub-task forever.
func TestCardsParentRLS_EditorCanClearAParent(t *testing.T) {
	env := setupCardsEnv(t)
	child := cardsCard(t, env.app, env.project, env.list, "child", "a1", env.owner)
	child.Set("parent", env.card.Id)
	if err := env.app.Save(child); err != nil {
		t.Fatalf("seed parent: %v", err)
	}

	req{
		method:  http.MethodPatch,
		url:     "/api/collections/cards_cards/records/" + child.Id,
		token:   env.editorToken,
		body:    `{"parent":""}`,
		want:    http.StatusOK,
		content: []string{`"parent":""`},
		after:   requireCardParent(child.Id, ""),
	}.run(t, env)
}

// The `:isset = false` branch — the positive control the pin lives alongside.
// Clients routinely PATCH a record without mentioning `parent`, and refusing
// those would break every ordinary edit.
func TestCardsParentRLS_AnEditWithoutParentIsUnaffected(t *testing.T) {
	env := setupCardsEnv(t)
	child := cardsCard(t, env.app, env.project, env.list, "child", "a1", env.owner)
	child.Set("parent", env.card.Id)
	if err := env.app.Save(child); err != nil {
		t.Fatalf("seed parent: %v", err)
	}

	req{
		method:  http.MethodPatch,
		url:     "/api/collections/cards_cards/records/" + child.Id,
		token:   env.editorToken,
		body:    `{"title":"renamed"}`,
		want:    http.StatusOK,
		content: []string{`"title":"renamed"`},
		// The parent survives an unrelated edit rather than being cleared.
		after: requireCardParent(child.Id, env.card.Id),
	}.run(t, env)
}

// Roles are unchanged by this feature, but the pin is conjoined onto the same
// rule that carries them — so a commentor must still be refused, proving the
// new clause did not accidentally widen the rule it was added to.
func TestCardsParentRLS_CommentorCannotParent(t *testing.T) {
	env := setupCardsEnv(t)
	child := cardsCard(t, env.app, env.project, env.list, "child", "a1", env.owner)

	req{
		method: http.MethodPatch,
		url:    "/api/collections/cards_cards/records/" + child.Id,
		token:  env.commentorToken,
		body:   `{"parent":"` + env.card.Id + `"}`,
		want:   http.StatusNotFound,
		after:  requireCardParent(child.Id, ""),
	}.run(t, env)
}

// requireCardParent asserts the STORED parent, the companion to
// requireCardProject: pair it with every refused PATCH, because a status
// assertion alone would pass if the row had been written and then hidden.
func requireCardParent(cardID, want string) func(t testing.TB, app *tests.TestApp) {
	return func(t testing.TB, app *tests.TestApp) {
		card, err := app.FindRecordById("cards_cards", cardID)
		if err != nil {
			t.Fatalf("reload card: %v", err)
		}
		if got := card.GetString("parent"); got != want {
			t.Fatalf("card parent = %q, want %q", got, want)
		}
	}
}
