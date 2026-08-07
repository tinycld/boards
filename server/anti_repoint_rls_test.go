package cards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

// The anti-repoint pins.
//
// The attack: an editor holds a membership on project A and none on project B.
// They PATCH a card they may legitimately edit on A with {"project": B}.
// viaWriter evaluates membership against the row's STORED project (A) and
// passes — so without a pin the write lands and the card materializes on a
// board the caller cannot reach.
//
//	pinProject = (@request.body.project:isset = false || @request.body.project = project)
//
// The `:isset = false` half is what lets an ordinary PATCH through: a client
// that echoes the whole record back must not be refused. Both halves need a
// test, and the deny needs a stored-value check — a status assertion alone
// would pass if PocketBase wrote the row and then returned 404.
//
// calendar/pb-migrations/1830000008 is where this bug was found for real.

// repointEnv is an editor on A with no standing on B.
type repointEnv struct {
	*cardsEnv
	editorToken string
	projectA    string
	projectB    string
	card        string
	cardTitle   string
}

func setupRepoint(t *testing.T) *repointEnv {
	t.Helper()
	env := setupCardsEnv(t)

	b := cardsProject(t, env.app, "Foreign", env.outsider)
	cardsMember(t, env.app, b, env.outsider, "owner")

	return &repointEnv{
		cardsEnv:    env,
		editorToken: env.editorToken,
		projectA:    env.project.Id,
		projectB:    b.Id,
		card:        env.card.Id,
		cardTitle:   "seeded-card",
	}
}

func TestCardsRepoint_EditorCannotRepointCardOntoForeignProject(t *testing.T) {
	r := setupRepoint(t)
	req{
		method: http.MethodPatch,
		url:    "/api/collections/cards_cards/records/" + r.card,
		token:  r.editorToken,
		body:   `{"project":"` + r.projectB + `"}`,
		want:   http.StatusNotFound,
		after:  requireCardProject(r.card, r.projectA),
	}.run(t, r.cardsEnv)
}

// The positive control the pin exists alongside: an ordinary edit still works.
func TestCardsRepoint_EditorCanUpdateWithoutProjectField(t *testing.T) {
	r := setupRepoint(t)
	req{
		method:  http.MethodPatch,
		url:     "/api/collections/cards_cards/records/" + r.card,
		token:   r.editorToken,
		body:    `{"title":"still-editable"}`,
		want:    http.StatusOK,
		content: []string{`"title":"still-editable"`},
	}.run(t, r.cardsEnv)
}

// Clients routinely PATCH a whole record back. Without the `:isset = false ||`
// half, every such write would be refused — and a "tighten the pin to always
// refuse project" change would look correct without this test.
func TestCardsRepoint_EditorCanRestateStoredProject(t *testing.T) {
	r := setupRepoint(t)
	req{
		method:  http.MethodPatch,
		url:     "/api/collections/cards_cards/records/" + r.card,
		token:   r.editorToken,
		body:    `{"project":"` + r.projectA + `","title":"echoed"}`,
		want:    http.StatusOK,
		content: []string{`"title":"echoed"`},
	}.run(t, r.cardsEnv)
}

// pinCard is a SEPARATE pin on three collections, and the project-pin cases
// cannot reach it: moving a checklist item between two cards of the same
// project never trips pinProject.
func TestCardsRepoint_ChecklistItemCannotBeRepointedOntoAnotherCard(t *testing.T) {
	env := setupCardsEnv(t)
	other := cardsCard(t, env.app, env.project, env.list, "other-card", "a5", env.owner)
	item := cardsChecklistItem(t, env.app, env.project, env.card, "step", "a0")

	req{
		method: http.MethodPatch,
		url:    "/api/collections/cards_checklist_items/records/" + item.Id,
		token:  env.editorToken,
		body:   `{"card":"` + other.Id + `"}`,
		want:   http.StatusNotFound,
		after: func(t testing.TB, app *tests.TestApp) {
			fresh, err := app.FindRecordById("cards_checklist_items", item.Id)
			if err != nil {
				t.Fatalf("re-read checklist item: %v", err)
			}
			if got := fresh.GetString("card"); got != env.card.Id {
				t.Fatalf("checklist item repointed to card %q", got)
			}
		},
	}.run(t, env)
}

func TestCardsRepoint_CommentCannotBeRepointedOntoAnotherCard(t *testing.T) {
	env := setupCardsEnv(t)
	other := cardsCard(t, env.app, env.project, env.list, "other-card", "a5", env.owner)
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "hello")

	req{
		method: http.MethodPatch,
		url:    "/api/collections/cards_comments/records/" + comment.Id,
		token:  env.editorToken,
		body:   `{"card":"` + other.Id + `"}`,
		want:   http.StatusNotFound,
		after: func(t testing.TB, app *tests.TestApp) {
			fresh, err := app.FindRecordById("cards_comments", comment.Id)
			if err != nil {
				t.Fatalf("re-read comment: %v", err)
			}
			if got := fresh.GetString("card"); got != env.card.Id {
				t.Fatalf("comment repointed to card %q", got)
			}
		},
	}.run(t, env)
}

// The highest-stakes pin in the package: the row carries role "owner" with it,
// so a successful repoint is a full takeover of the target board. This is
// calendar's bug transplanted one hop.
func TestCardsRepoint_MemberRowCannotBeRepointedOntoAnotherProject(t *testing.T) {
	r := setupRepoint(t)

	ownerRow, err := r.app.FindFirstRecordByFilter(
		"cards_project_members", "project = {:p} && user = {:u}",
		map[string]any{"p": r.projectA, "u": r.owner.Id},
	)
	if err != nil {
		t.Fatalf("find owner member row: %v", err)
	}

	req{
		method: http.MethodPatch,
		url:    "/api/collections/cards_project_members/records/" + ownerRow.Id,
		token:  r.ownerToken,
		body:   `{"project":"` + r.projectB + `"}`,
		want:   http.StatusNotFound,
		after: func(t testing.TB, app *tests.TestApp) {
			fresh, err := app.FindRecordById("cards_project_members", ownerRow.Id)
			if err != nil {
				t.Fatalf("re-read member row: %v", err)
			}
			if got := fresh.GetString("project"); got != r.projectA {
				t.Fatalf("member row repointed onto project %q — board takeover", got)
			}
		},
	}.run(t, r.cardsEnv)
}
