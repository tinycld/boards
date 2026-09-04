package boards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// Clause correlation — the property every other rule in this package rests on,
// and the one whose failure would be silent and total.
//
// `viaWriter` asks two questions of the SAME back-relation in two separate `?=`
// clauses:
//
//	project.boards_project_members_via_project.user ?= @request.auth.id
//	&& ( project.boards_project_members_via_project.role ?= "owner"
//	  || project.boards_project_members_via_project.role ?= "editor" )
//
// If PocketBase evaluated those independently, they would be satisfiable by two
// DIFFERENT member rows: the first by the caller's own viewer row, the second by
// somebody else's editor row. Every viewer on any board that also has an editor
// would silently gain write access — on all seven content collections at once.
//
// The migration asserts it correlates, on the strength of a reading of the
// vendored fork (`?=`/SignAnyEq is gated out of the MultiMatchSubquery wrapper,
// and joins dedupe by a path-derived alias, so both clauses land on the same
// JOIN). That is a claim about source code. These tests measure the behaviour.
//
// THE FIXTURE IS THE TEST. It must make the two clauses satisfiable only by
// different rows:
//
//	project P, user X as `viewer`, user Y as `editor`, acting as X.
//
// Weaker fixtures cannot catch the regression and will pass either way:
//   - X alone on the board — the role clause has no editor row to find
//     anywhere, so the deny happens for the wrong reason.
//   - X and Y on DIFFERENT projects — the back-relation is scoped by `project.`,
//     so Y's row is not in the joined set at all.
//
// Do not "simplify" these to a single-member fixture.

type correlationEnv struct {
	*cardsEnv
	x          *core.Record
	y          *core.Record
	xToken     string
	yToken     string
	project    *core.Record
	pProject   string
	pList      string
	pCard      string
	pCardTitle string
}

// setupCorrelation builds project P with X at `viewerRole` and Y at
// `writerRole`, plus one card to act on.
func setupCorrelation(t *testing.T, viewerRole, writerRole string) *correlationEnv {
	t.Helper()
	env := setupCardsEnv(t)

	x := cardsUser(t, env.app, "corr-x@test.local", "member")
	y := cardsUser(t, env.app, "corr-y@test.local", "member")

	p := cardsProject(t, env.app, "Correlation", y)
	cardsMember(t, env.app, p, x, viewerRole)
	cardsMember(t, env.app, p, y, writerRole)

	list := cardsList(t, env.app, p, "To do", "a0")
	card := cardsCard(t, env.app, p, list, "correlation-card", "a0", y)

	return &correlationEnv{
		cardsEnv:   env,
		x:          x,
		y:          y,
		xToken:     cardsToken(t, x),
		yToken:     cardsToken(t, y),
		project:    p,
		pProject:   p.Id,
		pList:      list.Id,
		pCard:      card.Id,
		pCardTitle: "correlation-card",
	}
}

// seedShareLink puts one link on a project so a "sees nothing" assertion means
// something — against an empty collection it would pass trivially.
func seedShareLink(t *testing.T, env *cardsEnv, projectID string, createdBy *core.Record) {
	t.Helper()
	col, err := env.app.FindCollectionByNameOrId("boards_share_links")
	if err != nil {
		t.Fatalf("find boards_share_links: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("project", projectID)
	r.Set("token", longToken)
	r.Set("role", "viewer")
	r.Set("created_by", createdBy.Id)
	r.Set("is_active", true)
	if err := env.app.Save(r); err != nil {
		t.Fatalf("save share link: %v", err)
	}
}

// A viewer sharing a board with an editor must not inherit the editor's write.
// This is the create half — the rule is evaluated against @request.body.
func TestCardsCorrelation_ViewerAlongsideEditorCannotCreateCard(t *testing.T) {
	c := setupCorrelation(t, "viewer", "editor")

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_cards/records",
		token:  c.xToken,
		body: `{"project":"` + c.pProject + `","list":"` + c.pList +
			`","title":"by-viewer","position":"a5","created_by":"` + c.x.Id + `"}`,
		want: http.StatusBadRequest,
	}.run(t, c.cardsEnv)
}

// The update half. A separate PocketBase code path from create: the rule is
// evaluated against the RESOLVED record rather than the request body, so
// correlation could in principle hold for one and not the other.
func TestCardsCorrelation_ViewerAlongsideEditorCannotUpdateCard(t *testing.T) {
	c := setupCorrelation(t, "viewer", "editor")

	req{
		method: http.MethodPatch,
		url:    "/api/collections/boards_cards/records/" + c.pCard,
		token:  c.xToken,
		body:   `{"title":"renamed-by-viewer"}`,
		want:   http.StatusNotFound,
		after:  requireCardTitle(c.pCard, c.pCardTitle),
	}.run(t, c.cardsEnv)
}

// The other branch of viaWriter's `||`. A correlation bug could surface on the
// owner branch and not the editor one.
func TestCardsCorrelation_ViewerAlongsideOwnerCannotUpdateCard(t *testing.T) {
	c := setupCorrelation(t, "viewer", "owner")

	req{
		method: http.MethodPatch,
		url:    "/api/collections/boards_cards/records/" + c.pCard,
		token:  c.xToken,
		body:   `{"title":"renamed-by-viewer"}`,
		want:   http.StatusNotFound,
		after:  requireCardTitle(c.pCard, c.pCardTitle),
	}.run(t, c.cardsEnv)
}

// THE MANDATORY POSITIVE CONTROL.
//
// Without this, a bug that broke viaWriter entirely — a mistyped back-relation
// resolving to the empty set, say — would turn all three deny-tests above green
// and be read as "correlation confirmed". This is what proves the denies are
// the rule working rather than the rule being broken.
func TestCardsCorrelation_EditorOnTheSameBoardStillCan(t *testing.T) {
	c := setupCorrelation(t, "viewer", "editor")

	req{
		method:  http.MethodPatch,
		url:     "/api/collections/boards_cards/records/" + c.pCard,
		token:   c.yToken,
		body:    `{"title":"renamed-by-editor"}`,
		want:    http.StatusOK,
		content: []string{`"title":"renamed-by-editor"`},
	}.run(t, c.cardsEnv)
}

// viaCommenter is a separate three-way `||` gating a separate collection. A
// correlation fix or regression could land on one composition and not the other.
func TestCardsCorrelation_ViewerAlongsideCommentorCannotComment(t *testing.T) {
	c := setupCorrelation(t, "viewer", "commentor")

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_comments/records",
		token:  c.xToken,
		body: `{"project":"` + c.pProject + `","card":"` + c.pCard +
			`","body":"comment-by-viewer"}`,
		want: http.StatusBadRequest,
	}.run(t, c.cardsEnv)
}

// viaOwner is the third distinct composition, and it guards the
// access-widening primitive: a share link mints membership on redemption.
func TestCardsCorrelation_ViewerAlongsideOwnerCannotReadShareLinks(t *testing.T) {
	c := setupCorrelation(t, "viewer", "owner")
	seedShareLink(t, c.cardsEnv, c.pProject, c.y)

	req{
		method:  http.MethodGet,
		url:     "/api/collections/boards_share_links/records",
		token:   c.xToken,
		want:    http.StatusOK,
		content: []string{`"totalItems":0`},
	}.run(t, c.cardsEnv)
}
