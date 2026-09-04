package boards

import (
	"net/http"
	"testing"
)

// boards_card_watchers access: any member may follow a card — for themselves
// only, on their own board only — and unfollow only themselves. No hooks
// bound; this measures the shipped rules.

func watcherBody(env *cardsEnv, userID string) string {
	return `{"project":"` + env.project.Id + `","card":"` + env.card.Id + `","user":"` + userID + `"}`
}

func TestWatchersRLS_ViewerCanWatchTheirOwnRow(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method:  http.MethodPost,
		url:     "/api/collections/boards_card_watchers/records",
		token:   env.viewerToken,
		body:    watcherBody(env, env.viewer.Id),
		want:    http.StatusOK,
		content: []string{`"user":"` + env.viewer.Id + `"`},
	}.run(t, env)
}

func TestWatchersRLS_CannotWatchOnBehalfOfAnother(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_card_watchers/records",
		token:  env.editorToken,
		body:   watcherBody(env, env.viewer.Id),
		want:   http.StatusBadRequest,
	}.run(t, env)
}

func TestWatchersRLS_OutsiderCannotWatch(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_card_watchers/records",
		token:  env.outsiderToken,
		body:   watcherBody(env, env.outsider.Id),
		want:   http.StatusBadRequest,
	}.run(t, env)
}

// The anti-desync pin: the card must belong to the named project.
func TestWatchersRLS_ProjectMustMatchTheCard(t *testing.T) {
	env := setupCardsEnv(t)
	other := cardsProject(t, env.app, "Other", env.owner)
	cardsMember(t, env.app, other, env.owner, "owner")
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_card_watchers/records",
		token:  env.ownerToken,
		body: `{"project":"` + other.Id + `","card":"` + env.card.Id +
			`","user":"` + env.owner.Id + `"}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

func TestWatchersRLS_OutsiderListsNothing(t *testing.T) {
	env := setupCardsEnv(t)
	ensureWatcher(env.app, env.project.Id, env.card.Id, env.viewer.Id)
	req{
		method:  http.MethodGet,
		url:     "/api/collections/boards_card_watchers/records",
		token:   env.outsiderToken,
		want:    http.StatusOK,
		content: []string{`"totalItems":0`},
	}.run(t, env)
}

func TestWatchersRLS_MemberListsTheRoster(t *testing.T) {
	env := setupCardsEnv(t)
	ensureWatcher(env.app, env.project.Id, env.card.Id, env.viewer.Id)
	req{
		method:  http.MethodGet,
		url:     "/api/collections/boards_card_watchers/records",
		token:   env.commentorToken,
		want:    http.StatusOK,
		content: []string{`"totalItems":1`},
	}.run(t, env)
}

func TestWatchersRLS_CanUnwatchOnlyYourself(t *testing.T) {
	env := setupCardsEnv(t)
	ensureWatcher(env.app, env.project.Id, env.card.Id, env.viewer.Id)
	rows := watcherRows(t, env)
	req{
		method: http.MethodDelete,
		url:    "/api/collections/boards_card_watchers/records/" + rows[env.viewer.Id],
		token:  env.editorToken,
		want:   http.StatusNotFound,
	}.run(t, env)
}

func TestWatchersRLS_CanUnwatchYourself(t *testing.T) {
	env := setupCardsEnv(t)
	ensureWatcher(env.app, env.project.Id, env.card.Id, env.viewer.Id)
	rows := watcherRows(t, env)
	req{
		method: http.MethodDelete,
		url:    "/api/collections/boards_card_watchers/records/" + rows[env.viewer.Id],
		token:  env.viewerToken,
		want:   http.StatusNoContent,
	}.run(t, env)
}

func watcherRows(t *testing.T, env *cardsEnv) map[string]string {
	t.Helper()
	rows, err := env.app.FindRecordsByFilter("boards_card_watchers", "card = {:card}", "", 0, 0,
		map[string]any{"card": env.card.Id})
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, r := range rows {
		out[r.GetString("user")] = r.Id
	}
	return out
}
