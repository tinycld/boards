package boards

import (
	"net/http"
	"testing"
)

// The two new card columns are ordinary columns under the card rules: an
// editor writes them, a viewer cannot, and a member reads them back.
func TestFormColumns_FollowTheCardRules(t *testing.T) {
	env := setupCardsEnv(t)
	card := cardsCard(t, env.app, env.project, env.list, "Typed", "a0", env.editor)
	url := "/api/collections/boards_cards/records/" + card.Id
	body := `{"fields":{"severity":"high"}}`

	req{
		method:  http.MethodPatch,
		url:     url,
		token:   env.editorToken,
		body:    body,
		want:    http.StatusOK,
		content: []string{`"severity":"high"`},
	}.run(t, env)

	req{
		method: http.MethodPatch,
		url:    url,
		token:  env.viewerToken,
		body:   `{"fields":{"severity":"low"}}`,
		want:   http.StatusNotFound,
	}.run(t, env)

	req{
		method:  http.MethodGet,
		url:     url,
		token:   env.viewerToken,
		want:    http.StatusOK,
		content: []string{`"severity":"high"`},
	}.run(t, env)
}
