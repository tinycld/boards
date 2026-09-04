package boards

import (
	"net/http"
	"testing"
)

// bootstrapFirstOwner — how a brand-new project gets its first owner.
//
//	user = @request.auth.id
//	&& role = "owner"
//	&& project.boards_project_members_via_project.id = ""
//	&& @request.auth.role != "guest"
//
// The third clause is PocketBase's "this back-relation is empty" idiom, and it
// leans on the operator the migration's own trap notes warn about: bare `=` on
// a multi-valued relation means "ALL elements match", which is vacuously true
// of an empty set. That is the entire trick, and it is the one deliberate bare
// `=` in the file — so it needs behavioural proof rather than a reviewer's
// confidence.
//
// This is also the gap calendar could not close. calendar_members' create rule
// admits a membership only when the caller ALREADY owns the calendar, which the
// first membership cannot satisfy, so calendar needs a privileged Go hook to
// write that row (see calendar/server/bootstrap_probe_test.go). Boards puts the
// bootstrap in the RULE, so ownership is established by the same request that
// creates the board — no hook has to fire, and nothing can leave a board owned
// by nobody if one fails to.

// The headline: a fresh non-guest user creates a board and self-grants
// ownership, entirely through the rules.
func TestCardsBootstrap_CreatorSelfGrantsFirstOwnership(t *testing.T) {
	env := setupCardsEnv(t)

	// Create the project over the API, as a real client would.
	created := cardsProject(t, env.app, "Fresh", env.outsider)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_project_members/records",
		token:  env.outsiderToken,
		body: `{"project":"` + created.Id + `","user":"` + env.outsider.Id +
			`","role":"owner"}`,
		want:    http.StatusOK,
		content: []string{`"role":"owner"`},
	}.run(t, env)
}

// The bound: once the board has members, the branch closes. Both halves of the
// create rule must refuse — ownerCanAdd because the caller holds no owner row,
// and bootstrapFirstOwner because the member set is non-empty. Without the
// `.id = ""` clause this is a takeover of any board in the org.
func TestCardsBootstrap_RefusedOnceTheProjectHasMembers(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_project_members/records",
		token:  env.outsiderToken,
		body: `{"project":"` + env.project.Id + `","user":"` + env.outsider.Id +
			`","role":"owner"}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

// bootstrapFirstOwner carries its OWN notGuest, in addition to the one on
// project-create. This is the only test that reaches it: the project has to be
// seeded memberless, or the guest is blocked one step earlier and the clause
// never evaluates.
func TestCardsBootstrap_GuestCannotBootstrapEvenOnAnEmptyProject(t *testing.T) {
	env := setupCardsEnv(t)
	memberless := cardsProject(t, env.app, "Memberless", env.owner)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_project_members/records",
		token:  env.guestToken,
		body: `{"project":"` + memberless.Id + `","user":"` + env.appGuest.Id +
			`","role":"owner"}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

// The branch is `role = "owner"`, deliberately narrow: the bootstrap exists to
// make a board manageable, not to be a self-service membership door.
func TestCardsBootstrap_CannotSelfGrantANonOwnerRole(t *testing.T) {
	env := setupCardsEnv(t)
	memberless := cardsProject(t, env.app, "Memberless", env.owner)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_project_members/records",
		token:  env.outsiderToken,
		body: `{"project":"` + memberless.Id + `","user":"` + env.outsider.Id +
			`","role":"editor"}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

// Guards `user = @request.auth.id`: without it any non-guest could plant an
// owner on any memberless board.
func TestCardsBootstrap_CannotBootstrapSomeoneElse(t *testing.T) {
	env := setupCardsEnv(t)
	memberless := cardsProject(t, env.app, "Memberless", env.owner)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_project_members/records",
		token:  env.outsiderToken,
		body: `{"project":"` + memberless.Id + `","user":"` + env.editor.Id +
			`","role":"owner"}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}
