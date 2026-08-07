package cards

import (
	"net/http"
	"testing"
)

// Guests, and the three rules that have no precedent anywhere else in the tree.
//
// Cards INVERTS drive's guest policy. Drive blocks guest creates outright
// (`notGuest` on drive_items.create) because a drive item has no parent to
// check against. Every cards content row names a `project`, so the create rule
// can require an existing editor/owner membership on it — that parent check IS
// the backstop, and it lives in the rule because a hosted tenant runs no
// feature Go.
//
// A wrong rule here is a write-capable stranger, which is why these get their
// own file.

// THE positive control for the entire guest model. Public boards with write
// access are a goal; if this fails, the share-link board is not buildable.
func TestCardsGuestRLS_GuestWithEditorMembershipCanCreateCard(t *testing.T) {
	env := setupCardsEnv(t)
	cardsMember(t, env.app, env.project, env.appGuest, "editor")

	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_cards/records",
		token:  env.guestToken,
		body: `{"project":"` + env.project.Id + `","list":"` + env.list.Id +
			`","title":"by-guest","position":"a9","created_by":"` + env.appGuest.Id + `"}`,
		want:    http.StatusOK,
		content: []string{`"title":"by-guest"`},
	}.run(t, env)
}

// The bound on the rule above: the membership is what grants the write, not the
// guest role. Without this, "a guest may create content" would be unlimited.
func TestCardsGuestRLS_GuestWithoutMembershipCannotCreateCard(t *testing.T) {
	env := setupCardsEnv(t)
	cardsMember(t, env.app, env.project, env.appGuest, "editor")

	// A second board the guest holds no row on.
	other := cardsProject(t, env.app, "Other", env.owner)
	cardsMember(t, env.app, other, env.owner, "owner")
	otherList := cardsList(t, env.app, other, "To do", "a0")

	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_cards/records",
		token:  env.guestToken,
		body: `{"project":"` + other.Id + `","list":"` + otherList.Id +
			`","title":"by-guest-elsewhere","position":"a9","created_by":"` + env.appGuest.Id + `"}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

// `notGuest` on cards_projects.create is the only thing between a share-link
// visitor and a board of their own — there is no membership to check on a
// project that does not exist yet.
func TestCardsGuestRLS_GuestCannotCreateProject(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_projects/records",
		token:  env.guestToken,
		body: `{"name":"guest-board","color":"#ef4444","visibility":"private",` +
			`"created_by":"` + env.appGuest.Id + `"}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

// The roster leak, and the subtlest rule in the package.
//
// list is `enabled && (ownMemberRow || rosterRule)` where rosterRule is
// member-AND-non-guest. So a guest holding a membership sees EXACTLY ONE row —
// their own — and never the co-members' names and emails. The assertion is
// therefore not "totalItems:0"; it is one row, and it must be theirs.
//
// ExpectedContent is substring-contains only, so the negative half needs a body
// check. The fixture seeds four other members precisely so a pass here cannot
// be an artifact of there being nothing to leak.
func TestCardsGuestRLS_GuestCannotListMemberRoster(t *testing.T) {
	env := setupCardsEnv(t)
	cardsMember(t, env.app, env.project, env.appGuest, "editor")

	req{
		method:  http.MethodGet,
		url:     "/api/collections/cards_project_members/records",
		token:   env.guestToken,
		want:    http.StatusOK,
		content: []string{`"totalItems":1`, `"user":"` + env.appGuest.Id + `"`},
		// The leak assertion proper: not one co-member id may appear.
		notContent: []string{env.owner.Id, env.editor.Id, env.commentor.Id, env.viewer.Id},
	}.run(t, env)
}

// The direct-fetch half of the same rule. List-filtering and view-refusal are
// separate code paths in PocketBase; a rule can be right for one and wrong for
// the other.
func TestCardsGuestRLS_GuestCannotViewACoMemberRow(t *testing.T) {
	env := setupCardsEnv(t)
	cardsMember(t, env.app, env.project, env.appGuest, "editor")

	ownerRow, err := env.app.FindFirstRecordByFilter(
		"cards_project_members", "project = {:p} && user = {:u}",
		map[string]any{"p": env.project.Id, "u": env.owner.Id},
	)
	if err != nil {
		t.Fatalf("find owner member row: %v", err)
	}

	req{
		method: http.MethodGet,
		url:    "/api/collections/cards_project_members/records/" + ownerRow.Id,
		token:  env.guestToken,
		want:   http.StatusNotFound,
	}.run(t, env)
}

// Positive control: the roster is not simply broken for everyone. Without this,
// a rule that hid the roster from ALL members would pass the guest tests above
// and read as correct.
func TestCardsGuestRLS_NonGuestMemberCanListTheRoster(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method:  http.MethodGet,
		url:     "/api/collections/cards_project_members/records",
		token:   env.viewerToken,
		want:    http.StatusOK,
		content: []string{`"totalItems":4`, `"user":"` + env.owner.Id + `"`},
	}.run(t, env)
}

// `enabled` (@request.auth.disabled != true) is conjoined onto all 45 rules.
// One behavioural probe proves the field resolves at all — a semantic inversion
// (`= false` instead of `!= true`) would not be caught by a string assertion.
func TestCardsGuestRLS_DisabledUserCannotRead(t *testing.T) {
	env := setupCardsEnv(t)

	fresh, err := env.app.FindRecordById("users", env.editor.Id)
	if err != nil {
		t.Fatalf("find editor: %v", err)
	}
	fresh.Set("disabled", true)
	if err := env.app.Save(fresh); err != nil {
		t.Fatalf("suspend editor: %v", err)
	}

	req{
		method:  http.MethodGet,
		url:     "/api/collections/cards_cards/records",
		token:   env.editorToken,
		want:    http.StatusOK,
		content: []string{`"totalItems":0`},
	}.run(t, env)
}

func TestCardsGuestRLS_DisabledUserCannotWrite(t *testing.T) {
	env := setupCardsEnv(t)

	fresh, err := env.app.FindRecordById("users", env.editor.Id)
	if err != nil {
		t.Fatalf("find editor: %v", err)
	}
	fresh.Set("disabled", true)
	if err := env.app.Save(fresh); err != nil {
		t.Fatalf("suspend editor: %v", err)
	}

	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_cards/records",
		token:  env.editorToken,
		body: `{"project":"` + env.project.Id + `","list":"` + env.list.Id +
			`","title":"by-suspended","position":"a9","created_by":"` + env.editor.Id + `"}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

