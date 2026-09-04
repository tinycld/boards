package boards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// boards_comment_reactions access: commentors and up may react — for
// themselves only, on a comment of the named card, on the named board — and
// take back only their own. Members and share-link visitors may read. No
// hooks bound; this measures the shipped rules.

func reactionBody(env *cardsEnv, commentID, userID, emoji string) string {
	return `{"project":"` + env.project.Id + `","card":"` + env.card.Id +
		`","comment":"` + commentID + `","user":"` + userID + `","emoji":"` + emoji + `"}`
}

func TestReactionsRLS_CommentorCanReactForThemselves(t *testing.T) {
	env := setupCardsEnv(t)
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "hello")
	req{
		method:  http.MethodPost,
		url:     "/api/collections/boards_comment_reactions/records",
		token:   env.commentorToken,
		body:    reactionBody(env, comment.Id, env.commentor.Id, "👍"),
		want:    http.StatusOK,
		content: []string{`"user":"` + env.commentor.Id + `"`},
	}.run(t, env)
}

func TestReactionsRLS_ViewerCannotReact(t *testing.T) {
	env := setupCardsEnv(t)
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "hello")
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_comment_reactions/records",
		token:  env.viewerToken,
		body:   reactionBody(env, comment.Id, env.viewer.Id, "👍"),
		want:   http.StatusBadRequest,
	}.run(t, env)
}

func TestReactionsRLS_CannotReactAsAnother(t *testing.T) {
	env := setupCardsEnv(t)
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "hello")
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_comment_reactions/records",
		token:  env.editorToken,
		body:   reactionBody(env, comment.Id, env.commentor.Id, "👍"),
		want:   http.StatusBadRequest,
	}.run(t, env)
}

// The palette is the schema: an emoji outside it is refused by the select.
func TestReactionsRLS_EmojiMustBeInThePalette(t *testing.T) {
	env := setupCardsEnv(t)
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "hello")
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_comment_reactions/records",
		token:  env.editorToken,
		body:   reactionBody(env, comment.Id, env.editor.Id, "🦄"),
		want:   http.StatusBadRequest,
	}.run(t, env)
}

// The anti-desync pins: the comment must be on the named card, and the card on
// the named board.
func TestReactionsRLS_CommentMustBelongToTheCard(t *testing.T) {
	env := setupCardsEnv(t)
	other := cardsCard(t, env.app, env.project, env.list, "Other card", "z9", env.owner)
	comment := cardsComment(t, env.app, env.project, other, env.editor, "elsewhere")
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_comment_reactions/records",
		token:  env.editorToken,
		body:   reactionBody(env, comment.Id, env.editor.Id, "👍"),
		want:   http.StatusBadRequest,
	}.run(t, env)
}

func TestReactionsRLS_ProjectMustMatchTheCard(t *testing.T) {
	env := setupCardsEnv(t)
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "hello")
	otherProject := cardsProject(t, env.app, "Other", env.owner)
	cardsMember(t, env.app, otherProject, env.owner, "owner")
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_comment_reactions/records",
		token:  env.ownerToken,
		body: `{"project":"` + otherProject.Id + `","card":"` + env.card.Id +
			`","comment":"` + comment.Id + `","user":"` + env.owner.Id + `","emoji":"👍"}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

// One row per (comment, user, emoji): the unique index refuses a repeat.
func TestReactionsRLS_DuplicateIsRefused(t *testing.T) {
	env := setupCardsEnv(t)
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "hello")
	seedReaction(t, env, comment.Id, env.editor.Id, "👍")
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_comment_reactions/records",
		token:  env.editorToken,
		body:   reactionBody(env, comment.Id, env.editor.Id, "👍"),
		want:   http.StatusBadRequest,
	}.run(t, env)
}

func TestReactionsRLS_OwnerCannotRemoveAnothersReaction(t *testing.T) {
	env := setupCardsEnv(t)
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "hello")
	id := seedReaction(t, env, comment.Id, env.commentor.Id, "👍").Id
	req{
		method: http.MethodDelete,
		url:    "/api/collections/boards_comment_reactions/records/" + id,
		token:  env.ownerToken,
		want:   http.StatusNotFound,
	}.run(t, env)
}

func TestReactionsRLS_CanRemoveYourOwn(t *testing.T) {
	env := setupCardsEnv(t)
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "hello")
	id := seedReaction(t, env, comment.Id, env.commentor.Id, "👍").Id
	req{
		method: http.MethodDelete,
		url:    "/api/collections/boards_comment_reactions/records/" + id,
		token:  env.commentorToken,
		want:   http.StatusNoContent,
	}.run(t, env)
}

func TestReactionsRLS_ViewerListsThemButOutsiderDoesNot(t *testing.T) {
	env := setupCardsEnv(t)
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "hello")
	seedReaction(t, env, comment.Id, env.commentor.Id, "👍")
	req{
		method:  http.MethodGet,
		url:     "/api/collections/boards_comment_reactions/records",
		token:   env.viewerToken,
		want:    http.StatusOK,
		content: []string{`"totalItems":1`},
	}.run(t, env)
}

func TestReactionsRLS_OutsiderListsNothing(t *testing.T) {
	env := setupCardsEnv(t)
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "hello")
	seedReaction(t, env, comment.Id, env.commentor.Id, "👍")
	req{
		method:  http.MethodGet,
		url:     "/api/collections/boards_comment_reactions/records",
		token:   env.outsiderToken,
		want:    http.StatusOK,
		content: emptyList,
	}.run(t, env)
}

// A public board shows its comments, so it shows their reactions — while the
// link is live, and not once it is revoked.
func TestReactionsRLS_ShareLinkReadsWhileLive(t *testing.T) {
	env := setupCardsEnv(t)
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "hello")
	row := seedReaction(t, env, comment.Id, env.commentor.Id, "👍")
	live := shareLink(t, env, env.project.Id, tok64("live"), "viewer", true, "")
	revoked := shareLink(t, env, env.project.Id, tok64("revoked"), "viewer", false, "")

	if !canViewWithToken(t, env.app, row, live, nil) {
		t.Error("a live share link must read a reaction on its board")
	}
	if canViewWithToken(t, env.app, row, revoked, nil) {
		t.Error("a revoked share link must not read a reaction")
	}
	if canViewWithToken(t, env.app, row, "", nil) {
		t.Error("no token and no session must not read a reaction")
	}
}

func seedReaction(t *testing.T, env *cardsEnv, commentID, userID, emoji string) *core.Record {
	t.Helper()
	col, err := env.app.FindCollectionByNameOrId("boards_comment_reactions")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(col)
	r.Set("project", env.project.Id)
	r.Set("card", env.card.Id)
	r.Set("comment", commentID)
	r.Set("user", userID)
	r.Set("emoji", emoji)
	if err := env.app.Save(r); err != nil {
		t.Fatalf("seed reaction: %v", err)
	}
	return r
}
