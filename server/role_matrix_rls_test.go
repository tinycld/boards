package cards

import (
	"net/http"
	"testing"
)

// The five-role matrix: non-member, viewer, commentor, editor, owner.
//
// Every deny is paired with a positive control, because a suite where
// everything is refused passes for free and proves nothing. The controls are
// not padding — one of them (EditorCanUpdateCardTitle) is the only thing
// standing between "the writing roles are named explicitly" and a rule that
// accidentally narrowed write to owners.
//
// TRAP 1 LIVES HERE, in the commentor cases, and nowhere else.
// Rewriting viaWriter to drive's `role ?!= "viewer"` idiom was measured against
// this suite: it does NOT admit a viewer (cards_project_members is UNIQUE on
// (project, user), so a viewer holds exactly one row and `?!= "viewer"` finds
// no other row to match), but it DOES admit a commentor. So the correlation
// suite — which only ever acts as a viewer — cannot see trap 1, and
// TestCardsMatrix_CommentorCannotUpdateCard is its actual detector. Verified by
// applying the broken rule and watching this case, and only this case, flip.
//
// cards_attachments is deliberately absent from the behavioural matrix: its
// create needs a multipart body, and its rule composition
// (viaWriter + isUploader + pin) is identical to cards_comments'
// (viaCommenter + isAuthor + pin), which is covered here. The clauses are
// asserted in the shipped-rules table instead. Revisit with M6, which is when
// attachments actually get built.

// --- non-member -------------------------------------------------------------

func TestCardsMatrix_OutsiderListsNoProjects(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method:  http.MethodGet,
		url:     "/api/collections/cards_projects/records",
		token:   env.outsiderToken,
		want:    http.StatusOK,
		content: []string{`"totalItems":0`},
	}.run(t, env)
}

func TestCardsMatrix_OutsiderCannotViewProjectById(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodGet,
		url:    "/api/collections/cards_projects/records/" + env.project.Id,
		token:  env.outsiderToken,
		want:   http.StatusNotFound,
	}.run(t, env)
}

// Sharper than the project case: cards_cards.view walks the DENORMALIZED
// project relation, so a bug in that back-relation shows here first.
func TestCardsMatrix_OutsiderCannotViewCardById(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodGet,
		url:    "/api/collections/cards_cards/records/" + env.card.Id,
		token:  env.outsiderToken,
		want:   http.StatusNotFound,
	}.run(t, env)
}

func TestCardsMatrix_OutsiderCannotCreateCardOnForeignProject(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_cards/records",
		token:  env.outsiderToken,
		body: `{"project":"` + env.project.Id + `","list":"` + env.list.Id +
			`","title":"by-outsider","position":"a9","created_by":"` + env.outsider.Id + `"}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

// Positive control for every outsider deny above: the token is valid and the
// user is not globally blocked. cards_projects.create carries no membership
// term, so any non-guest may mint their own board.
func TestCardsMatrix_OutsiderCanCreateOwnProject(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_projects/records",
		token:  env.outsiderToken,
		body: `{"name":"outsiders-own","color":"#22c55e","visibility":"private",` +
			`"created_by":"` + env.outsider.Id + `"}`,
		want:    http.StatusOK,
		content: []string{`"name":"outsiders-own"`},
	}.run(t, env)
}

// --- viewer -----------------------------------------------------------------

func TestCardsMatrix_ViewerCanViewCard(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method:  http.MethodGet,
		url:     "/api/collections/cards_cards/records/" + env.card.Id,
		token:   env.viewerToken,
		want:    http.StatusOK,
		content: []string{`"title":"seeded-card"`},
	}.run(t, env)
}

func TestCardsMatrix_ViewerCanListCards(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method:  http.MethodGet,
		url:     "/api/collections/cards_cards/records",
		token:   env.viewerToken,
		want:    http.StatusOK,
		content: []string{`"totalItems":1`},
	}.run(t, env)
}

func TestCardsMatrix_ViewerCannotCreateCard(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_cards/records",
		token:  env.viewerToken,
		body: `{"project":"` + env.project.Id + `","list":"` + env.list.Id +
			`","title":"by-viewer","position":"a9","created_by":"` + env.viewer.Id + `"}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

func TestCardsMatrix_ViewerCannotUpdateCardTitle(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPatch,
		url:    "/api/collections/cards_cards/records/" + env.card.Id,
		token:  env.viewerToken,
		body:   `{"title":"renamed-by-viewer"}`,
		want:   http.StatusNotFound,
		after:  requireCardTitle(env.card.Id, "seeded-card"),
	}.run(t, env)
}

// A move is filed separately from an edit because it is the operation a
// drag-and-drop board issues constantly. It goes through the same updateRule,
// and proving it explicitly stops a future "moves are cheap, relax the rule"
// change from being silent.
func TestCardsMatrix_ViewerCannotMoveCard(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPatch,
		url:    "/api/collections/cards_cards/records/" + env.card.Id,
		token:  env.viewerToken,
		body:   `{"list":"` + env.list2.Id + `","position":"a5"}`,
		want:   http.StatusNotFound,
		after: func(t testingTB, app testApp) {
			fresh, err := app.FindRecordById("cards_cards", env.card.Id)
			if err != nil {
				t.Fatalf("re-read card: %v", err)
			}
			if got := fresh.GetString("list"); got != env.list.Id {
				t.Fatalf("card moved to list %q despite the refusal", got)
			}
		},
	}.run(t, env)
}

func TestCardsMatrix_ViewerCannotDeleteCard(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodDelete,
		url:    "/api/collections/cards_cards/records/" + env.card.Id,
		token:  env.viewerToken,
		want:   http.StatusNotFound,
	}.run(t, env)
}

// Isolates viaCommenter's deliberate omission of `viewer`.
func TestCardsMatrix_ViewerCannotComment(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_comments/records",
		token:  env.viewerToken,
		body: `{"project":"` + env.project.Id + `","card":"` + env.card.Id +
			`","body":"by-viewer"}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

// --- commentor --------------------------------------------------------------

func TestCardsMatrix_CommentorCanCreateComment(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_comments/records",
		token:  env.commentorToken,
		body: `{"project":"` + env.project.Id + `","card":"` + env.card.Id +
			`","author":"` + env.commentor.Id + `","body":"by-commentor"}`,
		want:    http.StatusOK,
		content: []string{`"body":"by-commentor"`},
	}.run(t, env)
}

// Isolates the isAuthor conjunct: a commenter may not attribute a comment to
// someone else.
func TestCardsMatrix_CommentorCannotForgeCommentAuthor(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_comments/records",
		token:  env.commentorToken,
		body: `{"project":"` + env.project.Id + `","card":"` + env.card.Id +
			`","author":"` + env.editor.Id + `","body":"forged"}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

// *** THE TRAP 1 DETECTOR ***
//
// A commentor reads and comments; it never edits. Drive's updateRule once said
// `role ?!= "viewer"` — "any role that is not viewer" — which admitted
// commentor the day the role was added to the schema. Measured: rewriting
// cards' viaWriter to that idiom leaves every other test in this package green
// and flips exactly this one.
func TestCardsMatrix_CommentorCannotUpdateCard(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPatch,
		url:    "/api/collections/cards_cards/records/" + env.card.Id,
		token:  env.commentorToken,
		body:   `{"title":"renamed-by-commentor"}`,
		want:   http.StatusNotFound,
		after:  requireCardTitle(env.card.Id, "seeded-card"),
	}.run(t, env)
}

func TestCardsMatrix_CommentorCannotMoveCard(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPatch,
		url:    "/api/collections/cards_cards/records/" + env.card.Id,
		token:  env.commentorToken,
		body:   `{"list":"` + env.list2.Id + `","position":"a5"}`,
		want:   http.StatusNotFound,
	}.run(t, env)
}

// The read half — a commentor must still reach the board, or they cannot do
// the one thing the role exists for.
func TestCardsMatrix_CommentorCanViewCard(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method:  http.MethodGet,
		url:     "/api/collections/cards_cards/records/" + env.card.Id,
		token:   env.commentorToken,
		want:    http.StatusOK,
		content: []string{`"title":"seeded-card"`},
	}.run(t, env)
}

// --- editor -----------------------------------------------------------------

func TestCardsMatrix_EditorCanCreateCard(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_cards/records",
		token:  env.editorToken,
		body: `{"project":"` + env.project.Id + `","list":"` + env.list.Id +
			`","title":"by-editor","position":"a9","created_by":"` + env.editor.Id + `"}`,
		want:    http.StatusOK,
		content: []string{`"title":"by-editor"`},
	}.run(t, env)
}

// The positive control for naming the write roles: it must not have narrowed
// the grant to owners. This is drive's TestDriveEditorRLS_CanUpdateSharedItem.
func TestCardsMatrix_EditorCanUpdateCardTitle(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method:  http.MethodPatch,
		url:     "/api/collections/cards_cards/records/" + env.card.Id,
		token:   env.editorToken,
		body:    `{"title":"renamed-by-editor"}`,
		want:    http.StatusOK,
		content: []string{`"title":"renamed-by-editor"`},
	}.run(t, env)
}

func TestCardsMatrix_EditorCanMoveCard(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method:  http.MethodPatch,
		url:     "/api/collections/cards_cards/records/" + env.card.Id,
		token:   env.editorToken,
		body:    `{"list":"` + env.list2.Id + `","position":"a5"}`,
		want:    http.StatusOK,
		content: []string{`"list":"` + env.list2.Id + `"`},
	}.run(t, env)
}

func TestCardsMatrix_EditorCannotRenameProject(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPatch,
		url:    "/api/collections/cards_projects/records/" + env.project.Id,
		token:  env.editorToken,
		body:   `{"name":"renamed-by-editor"}`,
		want:   http.StatusNotFound,
		after: func(t testingTB, app testApp) {
			fresh, err := app.FindRecordById("cards_projects", env.project.Id)
			if err != nil {
				t.Fatalf("re-read project: %v", err)
			}
			if got := fresh.GetString("name"); got != "Board" {
				t.Fatalf("project renamed to %q despite the refusal", got)
			}
		},
	}.run(t, env)
}

func TestCardsMatrix_EditorCannotDeleteProject(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodDelete,
		url:    "/api/collections/cards_projects/records/" + env.project.Id,
		token:  env.editorToken,
		want:   http.StatusNotFound,
	}.run(t, env)
}

// A share link is an access-widening primitive: redeeming one mints membership.
// An editor who could mint one could escalate the whole board.
func TestCardsMatrix_EditorCannotMintShareLink(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_share_links/records",
		token:  env.editorToken,
		body: `{"project":"` + env.project.Id + `","token":"` + longToken +
			`","role":"editor","created_by":"` + env.editor.Id + `","is_active":true}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

// Targets a THIRD PARTY deliberately. A self-row would be rejected by the
// UNIQUE(project, user) index regardless of the rule, which would make this
// pass without proving anything about ownerCanAdd.
func TestCardsMatrix_EditorCannotAddAMember(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_project_members/records",
		token:  env.editorToken,
		body: `{"project":"` + env.project.Id + `","user":"` + env.outsider.Id +
			`","role":"viewer"}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

// --- owner ------------------------------------------------------------------

func TestCardsMatrix_OwnerCanRenameProject(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method:  http.MethodPatch,
		url:     "/api/collections/cards_projects/records/" + env.project.Id,
		token:   env.ownerToken,
		body:    `{"name":"renamed-by-owner"}`,
		want:    http.StatusOK,
		content: []string{`"name":"renamed-by-owner"`},
	}.run(t, env)
}

func TestCardsMatrix_OwnerCanAddAMember(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_project_members/records",
		token:  env.ownerToken,
		body: `{"project":"` + env.project.Id + `","user":"` + env.outsider.Id +
			`","role":"viewer"}`,
		want:    http.StatusOK,
		content: []string{`"role":"viewer"`},
	}.run(t, env)
}

func TestCardsMatrix_OwnerCanMintShareLink(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_share_links/records",
		token:  env.ownerToken,
		body: `{"project":"` + env.project.Id + `","token":"` + longToken +
			`","role":"viewer","created_by":"` + env.owner.Id + `","is_active":true}`,
		want:    http.StatusOK,
		content: []string{`"role":"viewer"`},
	}.run(t, env)
}

// The owner is also a writer under viaWriter — easy to break by writing the
// rule as "editor only".
func TestCardsMatrix_OwnerCanUpdateCard(t *testing.T) {
	env := setupCardsEnv(t)
	req{
		method:  http.MethodPatch,
		url:     "/api/collections/cards_cards/records/" + env.card.Id,
		token:   env.ownerToken,
		body:    `{"title":"renamed-by-owner"}`,
		want:    http.StatusOK,
		content: []string{`"title":"renamed-by-owner"`},
	}.run(t, env)
}
