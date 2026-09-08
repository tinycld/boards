package boards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// Votes on a card. The same shape as boards_comment_reactions one level up,
// so these mirror reactions_rls_test.go — what is asserted here is that the
// NEW collection carries the same rules, not that the rule engine works.

func cardReactionBody(env *cardsEnv, cardID, userID, emoji string) string {
	return `{"project":"` + env.project.Id + `","card":"` + cardID +
		`","user":"` + userID + `","emoji":"` + emoji + `"}`
}

func TestCardReactionsRLS_CommentorCanReactForThemselves(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method:  http.MethodPost,
		url:     "/api/collections/boards_card_reactions/records",
		token:   env.commentorToken,
		body:    cardReactionBody(env, env.card.Id, env.commentor.Id, "🚀"),
		want:    http.StatusOK,
		content: []string{`"emoji":"🚀"`},
	}.run(t, env)
}

// A vote is a lightweight comment, and 1980000000's doctrine is that a viewer
// is read-only.
func TestCardReactionsRLS_ViewerCannotReact(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_card_reactions/records",
		token:  env.viewerToken,
		body:   cardReactionBody(env, env.card.Id, env.viewer.Id, "🚀"),
		want:   http.StatusBadRequest,
	}.run(t, env)
}

func TestCardReactionsRLS_CannotReactAsAnother(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_card_reactions/records",
		token:  env.editorToken,
		body:   cardReactionBody(env, env.card.Id, env.owner.Id, "🚀"),
		want:   http.StatusBadRequest,
	}.run(t, env)
}

// The anti-desync pin: the card must belong to the named board, or the row
// resolves membership through a project its card is not on.
func TestCardReactionsRLS_ProjectMustMatchTheCard(t *testing.T) {
	env := setupCardsEnv(t)
	otherProject := cardsProject(t, env.app, "Other", env.owner)
	cardsMember(t, env.app, otherProject, env.editor, "editor")
	body := `{"project":"` + otherProject.Id + `","card":"` + env.card.Id +
		`","user":"` + env.editor.Id + `","emoji":"🚀"}`
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_card_reactions/records",
		token:  env.editorToken,
		body:   body,
		want:   http.StatusBadRequest,
	}.run(t, env)
}

// The unique index: one person, one emoji, one card.
func TestCardReactionsRLS_DuplicateIsRefused(t *testing.T) {
	env := setupCardsEnv(t)
	seedCardReaction(t, env, env.card.Id, env.editor.Id, "🚀")
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_card_reactions/records",
		token:  env.editorToken,
		body:   cardReactionBody(env, env.card.Id, env.editor.Id, "🚀"),
		want:   http.StatusBadRequest,
	}.run(t, env)
}

func TestCardReactionsRLS_CanRemoveYourOwn(t *testing.T) {
	env := setupCardsEnv(t)
	row := seedCardReaction(t, env, env.card.Id, env.editor.Id, "🚀")
	req{
		method: http.MethodDelete,
		url:    "/api/collections/boards_card_reactions/records/" + row.Id,
		token:  env.editorToken,
		want:   http.StatusNoContent,
	}.run(t, env)
}

func TestCardReactionsRLS_OwnerCannotRemoveAnothers(t *testing.T) {
	env := setupCardsEnv(t)
	row := seedCardReaction(t, env, env.card.Id, env.editor.Id, "🚀")
	req{
		method: http.MethodDelete,
		url:    "/api/collections/boards_card_reactions/records/" + row.Id,
		token:  env.ownerToken,
		want:   http.StatusNotFound,
	}.run(t, env)
}

func TestCardReactionsRLS_OutsiderListsNothing(t *testing.T) {
	env := setupCardsEnv(t)
	seedCardReaction(t, env, env.card.Id, env.editor.Id, "🚀")
	req{
		method:     http.MethodGet,
		url:        "/api/collections/boards_card_reactions/records",
		token:      env.outsiderToken,
		want:       http.StatusOK,
		content:    []string{`"totalItems":0`},
		notContent: []string{"🚀"},
	}.run(t, env)
}

func seedCardReaction(t *testing.T, env *cardsEnv, cardID, userID, emoji string) *core.Record {
	t.Helper()
	col, err := env.app.FindCollectionByNameOrId("boards_card_reactions")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(col)
	r.Set("project", env.project.Id)
	r.Set("card", cardID)
	r.Set("user", userID)
	r.Set("emoji", emoji)
	if err := env.app.Save(r); err != nil {
		t.Fatalf("seed card reaction: %v", err)
	}
	return r
}
