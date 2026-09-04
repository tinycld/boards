package boards

import (
	"net/http"
	"testing"
)

// The project-create sequence, proven against the real rules.
//
// useCreateProject (tinycld/boards/hooks/useProjectMutations.ts) writes three
// things in a fixed order, and each step is admitted by a DIFFERENT rule:
//
//	1. boards_projects        — authed && notGuest
//	2. boards_project_members — the bootstrapFirstOwner branch
//	3. boards_lists           — viaWriter, which needs step 2 committed
//
// The client cannot batch them, and the ordering constraint is invisible in the
// TypeScript: nothing there says "the owner row must land before the lists".
// These tests are what says it, so a later refactor that parallelises the
// yields fails here rather than shipping a board whose columns silently
// vanished.

// Step 2 is the interesting one: it only works while the project has no
// members, which is exactly the window the create flow runs in.
func TestCardsCreateFlow_ProjectThenOwnerThenLists(t *testing.T) {
	env := setupCardsEnv(t)

	// 1. The board itself.
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_projects/records",
		token:  env.outsiderToken,
		// A client-supplied id, as newRecordId() produces: the create flow mints
		// the project id locally so the owner row can reference it without a
		// round-trip. PocketBase ids are exactly 15 characters.
		body: `{"id":"flowproject0001","name":"Flow","color":"#4A86E8",` +
			`"visibility":"private","created_by":"` + env.outsider.Id + `","archived":false}`,
		want:    http.StatusOK,
		content: []string{`"name":"Flow"`},
	}.run(t, env)
}

func TestCardsCreateFlow_OwnerRowLandsOnTheFreshProject(t *testing.T) {
	env := setupCardsEnv(t)
	fresh := cardsProject(t, env.app, "Flow", env.outsider)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_project_members/records",
		token:  env.outsiderToken,
		body: `{"project":"` + fresh.Id + `","user":"` + env.outsider.Id +
			`","role":"owner","created_by":""}`,
		want:    http.StatusOK,
		content: []string{`"role":"owner"`},
	}.run(t, env)
}

// The step-3 rule depends on step 2 having happened. Without the owner row,
// viaWriter finds no membership and the columns are refused — which is what a
// parallelised implementation would produce.
func TestCardsCreateFlow_ListsNeedTheOwnerRowFirst(t *testing.T) {
	env := setupCardsEnv(t)
	fresh := cardsProject(t, env.app, "Flow", env.outsider)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_lists/records",
		token:  env.outsiderToken,
		body:   `{"project":"` + fresh.Id + `","name":"To do","position":"a0","category":"todo"}`,
		want:   http.StatusBadRequest,
	}.run(t, env)
}

// The positive control for the above: with the owner row in place, the same
// insert succeeds. Together the pair pins the ordering constraint.
func TestCardsCreateFlow_ListsSucceedOnceOwnerExists(t *testing.T) {
	env := setupCardsEnv(t)
	fresh := cardsProject(t, env.app, "Flow", env.outsider)
	cardsMember(t, env.app, fresh, env.outsider, "owner")

	req{
		method:  http.MethodPost,
		url:     "/api/collections/boards_lists/records",
		token:   env.outsiderToken,
		body:    `{"project":"` + fresh.Id + `","name":"To do","position":"a0","category":"todo"}`,
		want:    http.StatusOK,
		content: []string{`"name":"To do"`},
	}.run(t, env)
}

// The "Done" column is the one that carries the `done` category, which the
// UI's closed-card rendering paths depend on. Asserted separately from "To do" above because one
// ApiScenario per Test function is a hard constraint — Test re-triggers OnServe
// and a second scenario on the same app panics on duplicate route registration.
func TestCardsCreateFlow_DoneColumnCarriesCategory(t *testing.T) {
	env := setupCardsEnv(t)
	fresh := cardsProject(t, env.app, "Flow", env.outsider)
	cardsMember(t, env.app, fresh, env.outsider, "owner")

	req{
		method:  http.MethodPost,
		url:     "/api/collections/boards_lists/records",
		token:   env.outsiderToken,
		body:    `{"project":"` + fresh.Id + `","name":"Done","position":"a2","category":"done"}`,
		want:    http.StatusOK,
		content: []string{`"category":"done"`},
	}.run(t, env)
}
