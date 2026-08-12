package cards

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// Behavioural proof of the share-token read rules (pb-migrations/1980000003).
//
// The migration's doc comment makes six claims about PocketBase internals —
// that @request.auth is NULL for an anon, that `?=` avoids the multi-match
// wrapper, that @collection registers an unconstrained join, that unaliased
// @collection clauses correlate, that the joined collection's own listRule is
// not injected, and that an unset date reads as "". Every one of them is read
// off a vendored fork we do not control the release cadence of. This file
// exists so a PB bump that changes any of them fails HERE, loudly, rather than
// silently making a public board readable to nobody — or worse, readable to
// everybody.
//
// THE FIXTURE IS THE TEST. Two projects, each with its own content AND its own
// valid link. A single-project fixture cannot catch the one catastrophic bug in
// this design: drop `project ?= <ref>` from the rule and every assertion about
// project A still passes, because the cross join happily pairs A's token with
// A's rows. It is B's rows appearing that proves the correlation clause is
// doing its job. (Same shape as M2a's clause-correlation finding, where a
// single-member fixture could not see trap 1.)
//
// ALWAYS `go test -count=1`. The migration is a data file, so Go's test cache
// does not invalidate when a rule changes and a stale green looks identical to
// a real one.

// shareTokenEnv is two complete boards. Everything on B exists so that "the
// token for A does not reach it" is a real assertion rather than a query
// against an empty table.
type shareTokenEnv struct {
	*cardsEnv

	// Board A — the shared one. `card`, `list` etc. come from cardsEnv.
	aLabel     *core.Record
	aComment   *core.Record
	aCheckItem *core.Record
	aAttach    *core.Record

	// Board B — never shared with A's tokens.
	bProject   *core.Record
	bList      *core.Record
	bCard      *core.Record
	bLabel     *core.Record
	bComment   *core.Record
	bCheckItem *core.Record
	bAttach    *core.Record

	// Tokens on A.
	tokLive    string // viewer, active, no expiry
	tokEditor  string // editor role — proves role is not an anonymous grant
	tokRevoked string // is_active = false
	tokExpired string // expires_at in the past
	tokFuture  string // expires_at in the future — the live-with-expiry case

	// A live token on B, so B is genuinely shareable and its rows are only
	// hidden from A's tokens rather than from everyone.
	tokB string
}

// shareLink writes one link row. Unlike clause_correlation_rls_test.go's
// seedShareLink this varies role, activity and expiry, because those three are
// exactly what the rule inspects.
//
// `expires` is written verbatim so a caller can pass "" — an unset PB date
// stores the empty string, which is the branch `expires_at ?= ""` matches.
func shareLink(
	t *testing.T,
	env *cardsEnv,
	projectID, token, role string,
	active bool,
	expires string,
) string {
	t.Helper()
	col, err := env.app.FindCollectionByNameOrId("cards_share_links")
	if err != nil {
		t.Fatalf("find cards_share_links: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("project", projectID)
	r.Set("token", token)
	r.Set("role", role)
	r.Set("created_by", env.owner.Id)
	r.Set("is_active", active)
	r.Set("expires_at", expires)
	if err := env.app.Save(r); err != nil {
		t.Fatalf("save share link (%s): %v", token, err)
	}
	return token
}

// tok64 pads a readable name out to the 64 chars the token field requires, so
// a failing assertion names which link it was rather than showing 64 hex
// digits that all look alike.
func tok64(name string) string {
	return name + strings.Repeat("0", 64-len(name))
}

// cardsLabel seeds a label. Lives here rather than in rls_setup_test.go
// because this is the first suite that needs one — the role-matrix suites
// exercise labels only through create attempts.
func cardsLabel(t *testing.T, app core.App, project *core.Record, name, color string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("cards_labels")
	if err != nil {
		t.Fatalf("find cards_labels: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("project", project.Id)
	r.Set("name", name)
	r.Set("color", color)
	if err := app.Save(r); err != nil {
		t.Fatalf("save label %s: %v", name, err)
	}
	return r
}

func setupShareTokenEnv(t *testing.T) *shareTokenEnv {
	t.Helper()
	base := setupCardsEnv(t)
	env := &shareTokenEnv{cardsEnv: base}

	// Flesh out board A so every collection carrying the disjunct has a row.
	env.aLabel = cardsLabel(t, base.app, base.project, "a-label", "#ef4444")
	env.aComment = cardsComment(t, base.app, base.project, base.card, base.owner, "a-comment")
	env.aCheckItem = cardsChecklistItem(t, base.app, base.project, base.card, "a-check", "a0")
	env.aAttach = cardsAttachment(t, base.app, base.project, base.card, base.owner, "a-file.txt")

	// Board B, owned by the same owner so the only thing separating them is
	// the project relation the rule correlates on.
	env.bProject = cardsProject(t, base.app, "Board B", base.owner)
	cardsMember(t, base.app, env.bProject, base.owner, "owner")
	env.bList = cardsList(t, base.app, env.bProject, "B To do", "a0")
	env.bCard = cardsCard(t, base.app, env.bProject, env.bList, "b-secret-card", "a0", base.owner)
	env.bLabel = cardsLabel(t, base.app, env.bProject, "b-label", "#22c55e")
	env.bComment = cardsComment(t, base.app, env.bProject, env.bCard, base.owner, "b-comment")
	env.bCheckItem = cardsChecklistItem(t, base.app, env.bProject, env.bCard, "b-check", "a0")
	env.bAttach = cardsAttachment(t, base.app, env.bProject, env.bCard, base.owner, "b-file.txt")

	past := time.Now().UTC().Add(-24 * time.Hour).Format("2006-01-02 15:04:05.000Z")
	future := time.Now().UTC().Add(24 * time.Hour).Format("2006-01-02 15:04:05.000Z")

	env.tokLive = shareLink(t, base, base.project.Id, tok64("live"), "viewer", true, "")
	env.tokEditor = shareLink(t, base, base.project.Id, tok64("editor"), "editor", true, "")
	env.tokRevoked = shareLink(t, base, base.project.Id, tok64("revoked"), "viewer", false, "")
	env.tokExpired = shareLink(t, base, base.project.Id, tok64("expired"), "viewer", true, past)
	env.tokFuture = shareLink(t, base, base.project.Id, tok64("future"), "viewer", true, future)
	env.tokB = shareLink(t, base, env.bProject.Id, tok64("boardb"), "viewer", true, "")

	return env
}

// anonReq drives a request with NO Authorization header and an optional
// X-Share-Token. The shared `req` helper always sends Authorization, which
// would make every case here an authenticated one and quietly test the wrong
// rule branch.
type anonReq struct {
	method     string
	url        string
	shareToken string // omitted when empty — the "no header at all" case
	body       string
	want       int
	content    []string
	notContent []string
	after      func(t testing.TB, app *tests.TestApp)
}

func (r anonReq) run(t *testing.T, env *shareTokenEnv) {
	t.Helper()

	expected := r.content
	if len(expected) == 0 && r.want >= 400 {
		expected = []string{`"message"`}
	}

	headers := map[string]string{}
	if r.shareToken != "" {
		headers["X-Share-Token"] = r.shareToken
	}
	var body io.Reader
	if r.body != "" {
		headers["Content-Type"] = "application/json"
		body = strings.NewReader(r.body)
	}

	scenario := &tests.ApiScenario{
		Name:                  r.method + " " + r.url + " (anon)",
		Method:                r.method,
		URL:                   r.url,
		Body:                  body,
		Headers:               headers,
		ExpectedStatus:        r.want,
		ExpectedContent:       expected,
		NotExpectedContent:    r.notContent,
		TestAppFactory:        func(testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}
	if r.after != nil {
		after := r.after
		scenario.AfterTestFunc = func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			after(t, app)
		}
	}
	scenario.Test(t)
}

// emptyList is what a filtered list looks like: 200, zero rows. A refused list
// is never a 4xx — the rule filters rather than rejects.
var emptyList = []string{`"totalItems":0`}

// canViewWithToken evaluates a collection's REAL viewRule against a synthetic
// request carrying the given share token (and optionally an authenticated
// user), returning whether the row would be readable.
//
// This exists because a Test function may drive only ONE ApiScenario — the
// second rebuilds the mux and panics on duplicate routes. Cases that need two
// requests to mean anything (read, revoke, read again) go through the rule
// engine directly instead. It is the same entry point the API uses for a view
// (core/record_query.go:622, CanAccessRecord with allowHiddenFields=true), so
// it exercises the shipped rule rather than a paraphrase of it.
func canViewWithToken(
	t *testing.T,
	app core.App,
	record *core.Record,
	shareToken string,
	auth *core.Record,
) bool {
	t.Helper()
	info := &core.RequestInfo{
		Context: core.RequestInfoContextDefault,
		Method:  http.MethodGet,
		Headers: map[string]string{},
		Query:   map[string]string{},
		Auth:    auth,
	}
	if shareToken != "" {
		// Snakecased exactly as PB does for a real header.
		info.Headers["x_share_token"] = shareToken
	}
	ok, err := app.CanAccessRecord(record, info, record.Collection().ViewRule)
	if err != nil {
		t.Fatalf("evaluate viewRule for %s: %v", record.Collection().Name, err)
	}
	return ok
}

// ---------------------------------------------------------------------------
// The happy path: a live token reads every collection carrying the disjunct.
//
// ONE ApiScenario PER Test FUNCTION, here as everywhere in this package.
// ApiScenario.Test re-triggers OnServe, and a second scenario against the same
// app panics on duplicate route registration ("GET /_/extensions.js conflicts
// with GET /_/extensions.js"). That is why these are seven functions and not
// one table-driven loop — the table reads better right up until it panics.

func TestShareToken_LiveTokenReadsProject(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_projects/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		content:    []string{env.project.Id},
	}.run(t, env)
}

func TestShareToken_LiveTokenReadsLists(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_lists/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		content:    []string{env.list.Id},
	}.run(t, env)
}

func TestShareToken_LiveTokenReadsCards(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_cards/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		content:    []string{env.card.Id},
	}.run(t, env)
}

func TestShareToken_LiveTokenReadsLabels(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_labels/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		content:    []string{env.aLabel.Id},
	}.run(t, env)
}

func TestShareToken_LiveTokenReadsChecklistItems(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_checklist_items/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		content:    []string{env.aCheckItem.Id},
	}.run(t, env)
}

func TestShareToken_LiveTokenReadsComments(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_comments/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		content:    []string{env.aComment.Id},
	}.run(t, env)
}

func TestShareToken_LiveTokenReadsAttachments(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_attachments/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		content:    []string{env.aAttach.Id},
	}.run(t, env)
}

// A token whose link carries a FUTURE expiry is live. Pairs with the expired
// case below: together they prove `?>` against @now compares as a date and not
// as an accidental string truth.
func TestShareToken_FutureExpiryIsLive(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_cards/records",
		shareToken: env.tokFuture,
		want:       http.StatusOK,
		content:    []string{env.card.Id},
	}.run(t, env)
}

// ---------------------------------------------------------------------------
// Cross-board isolation. THE tests. Delete `project ?= <ref>` from the
// migration and these are the only ones that fail.

// notContent, not a totalItems count: each response legitimately carries A's
// rows, so the only way to state "and none of B's" is to name B's id and
// assert its absence. ExpectedContent can only ever prove presence — the
// guest_create_rls_test.go lesson.

func TestShareToken_BoardATokenSeesNoBoardBLists(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_lists/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		notContent: []string{env.bList.Id},
	}.run(t, env)
}

func TestShareToken_BoardATokenSeesNoBoardBCards(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_cards/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		notContent: []string{env.bCard.Id},
	}.run(t, env)
}

func TestShareToken_BoardATokenSeesNoBoardBLabels(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_labels/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		notContent: []string{env.bLabel.Id},
	}.run(t, env)
}

func TestShareToken_BoardATokenSeesNoBoardBChecklistItems(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_checklist_items/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		notContent: []string{env.bCheckItem.Id},
	}.run(t, env)
}

func TestShareToken_BoardATokenSeesNoBoardBComments(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_comments/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		notContent: []string{env.bComment.Id},
	}.run(t, env)
}

func TestShareToken_BoardATokenSeesNoBoardBAttachments(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_attachments/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		notContent: []string{env.bAttach.Id},
	}.run(t, env)
}

func TestShareToken_BoardATokenCannotSeeBoardBProject(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_projects/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		content:    []string{env.project.Id},
		notContent: []string{env.bProject.Id},
	}.run(t, env)
}

// view is a SEPARATE code path from list — a rule can filter a collection
// correctly and still resolve a single record by id. Both halves need proving.
// The card is the highest-value one (it carries the board's actual content),
// and the project is the container; between them they cover both `ref` forms
// the rule uses, `project` and `id`.

func TestShareToken_BoardATokenCannotViewBoardBProjectById(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_projects/records/" + env.bProject.Id,
		shareToken: env.tokLive,
		want:       http.StatusNotFound,
	}.run(t, env)
}

func TestShareToken_BoardATokenCannotViewBoardBCardById(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_cards/records/" + env.bCard.Id,
		shareToken: env.tokLive,
		want:       http.StatusNotFound,
	}.run(t, env)
}

func TestShareToken_BoardATokenCannotViewBoardBCommentById(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_comments/records/" + env.bComment.Id,
		shareToken: env.tokLive,
		want:       http.StatusNotFound,
	}.run(t, env)
}

// ---------------------------------------------------------------------------
// Liveness: revoked, expired, unknown, and no header at all.

func TestShareToken_RevokedTokenListsNothing(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_cards/records",
		shareToken: env.tokRevoked,
		want:       http.StatusOK,
		content:    emptyList,
	}.run(t, env)
}

func TestShareToken_RevokedTokenCannotViewById(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_cards/records/" + env.card.Id,
		shareToken: env.tokRevoked,
		want:       http.StatusNotFound,
	}.run(t, env)
}

func TestShareToken_ExpiredTokenListsNothing(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_cards/records",
		shareToken: env.tokExpired,
		want:       http.StatusOK,
		content:    emptyList,
	}.run(t, env)
}

func TestShareToken_ExpiredTokenCannotViewById(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_cards/records/" + env.card.Id,
		shareToken: env.tokExpired,
		want:       http.StatusNotFound,
	}.run(t, env)
}

func TestShareToken_UnknownTokenReadsNothing(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_cards/records",
		shareToken: tok64("nosuchtoken"),
		want:       http.StatusOK,
		content:    emptyList,
	}.run(t, env)
}

// The regression guard for an accidentally-public rule. If someone rewrites
// the disjunct in a way that is satisfiable with no token — an `||` in the
// wrong place, a clause that resolves NULL-truthy — every other test in this
// file still passes and only this one fails.
func TestShareToken_NoHeaderReadsNoCards(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:  http.MethodGet,
		url:     "/api/collections/cards_cards/records",
		want:    http.StatusOK,
		content: emptyList,
	}.run(t, env)
}

func TestShareToken_NoHeaderReadsNoProjects(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:  http.MethodGet,
		url:     "/api/collections/cards_projects/records",
		want:    http.StatusOK,
		content: emptyList,
	}.run(t, env)
}

// ---------------------------------------------------------------------------
// What a token must never reach, however live it is.

func TestShareToken_CannotReadRoster(t *testing.T) {
	env := setupShareTokenEnv(t)

	// The roster is the org's names and emails. rosterRule keeps a share-link
	// visitor out and core's 1870000000 closes the same leak on `users`;
	// 1980000003 deliberately adds no disjunct to either.
	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_project_members/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		content:    emptyList,
		notContent: []string{env.owner.Id, env.editor.Id, env.viewer.Id},
	}.run(t, env)
}

func TestShareToken_CannotEnumerateShareLinks(t *testing.T) {
	env := setupShareTokenEnv(t)

	// A token that could list cards_share_links would hand its holder every
	// other board's tokens — including boards it has no access to.
	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/cards_share_links/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		content:    emptyList,
		notContent: []string{env.tokB, env.tokEditor},
	}.run(t, env)
}

// 403 rather than an empty list: core's users collection has no list rule for
// an anonymous caller at all, so PB refuses outright instead of filtering. The
// distinction does not matter to a visitor — either way they read no names and
// no emails — but the status does, so the assertion states the real one.
func TestShareToken_CannotReadUsers(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/users/records",
		shareToken: env.tokLive,
		want:       http.StatusForbidden,
		notContent: []string{"owner@test.local", "editor@test.local"},
	}.run(t, env)
}

// ---------------------------------------------------------------------------
// Read-only, structurally — even on an EDITOR link.
//
// The link role is a ceiling for OTP redemption, not an anonymous grant. Every
// refusal re-reads the row: a status assertion alone would pass even if PB had
// written the row and then 404'd on the way out.

func TestShareToken_EditorLinkCannotCreateCard(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodPost,
		url:        "/api/collections/cards_cards/records",
		shareToken: env.tokEditor,
		body: fmt.Sprintf(
			`{"project":"%s","list":"%s","title":"forged","position":"a9"}`,
			env.project.Id, env.list.Id,
		),
		want: http.StatusBadRequest,
		after: func(t testing.TB, app *tests.TestApp) {
			rows, err := app.FindRecordsByFilter(
				"cards_cards", "title = 'forged'", "", 0, 0, nil)
			if err != nil {
				t.Fatalf("re-read cards: %v", err)
			}
			if len(rows) != 0 {
				t.Fatalf("an anonymous editor-link caller created %d card(s)", len(rows))
			}
		},
	}.run(t, env)
}

func TestShareToken_EditorLinkCannotUpdateCard(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodPatch,
		url:        "/api/collections/cards_cards/records/" + env.card.Id,
		shareToken: env.tokEditor,
		body:       `{"title":"rewritten"}`,
		want:       http.StatusNotFound,
		after:      requireCardTitle(env.card.Id, "seeded-card"),
	}.run(t, env)
}

func TestShareToken_EditorLinkCannotCreateComment(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodPost,
		url:        "/api/collections/cards_comments/records",
		shareToken: env.tokEditor,
		body: fmt.Sprintf(
			`{"project":"%s","card":"%s","body":"forged"}`,
			env.project.Id, env.card.Id,
		),
		want: http.StatusBadRequest,
		after: func(t testing.TB, app *tests.TestApp) {
			rows, err := app.FindRecordsByFilter(
				"cards_comments", "body = 'forged'", "", 0, 0, nil)
			if err != nil {
				t.Fatalf("re-read comments: %v", err)
			}
			if len(rows) != 0 {
				t.Fatalf("an anonymous editor-link caller created %d comment(s)", len(rows))
			}
		},
	}.run(t, env)
}

func TestShareToken_EditorLinkCannotDeleteList(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodDelete,
		url:        "/api/collections/cards_lists/records/" + env.list.Id,
		shareToken: env.tokEditor,
		want:       http.StatusNotFound,
		after: func(t testing.TB, app *tests.TestApp) {
			if _, err := app.FindRecordById("cards_lists", env.list.Id); err != nil {
				t.Fatalf("list was deleted despite the refusal: %v", err)
			}
		},
	}.run(t, env)
}

// The anti-repoint case, restated for a token caller: a refused PATCH must not
// move a card onto the board the caller cannot reach.
func TestShareToken_EditorLinkCannotRepointCardToOtherBoard(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method:     http.MethodPatch,
		url:        "/api/collections/cards_cards/records/" + env.card.Id,
		shareToken: env.tokEditor,
		body:       fmt.Sprintf(`{"project":"%s"}`, env.bProject.Id),
		want:       http.StatusNotFound,
		after:      requireCardProject(env.card.Id, env.project.Id),
	}.run(t, env)
}

// ---------------------------------------------------------------------------
// Revocation is immediate — no session, no cache. The rule re-evaluates
// is_active on every request, which is the main advantage this design has over
// minting a membership at redemption.

func TestShareToken_RevocationTakesEffectImmediately(t *testing.T) {
	env := setupShareTokenEnv(t)

	if !canViewWithToken(t, env.app, env.card, env.tokLive, nil) {
		t.Fatal("a live token could not read the card before revocation")
	}

	link, err := env.app.FindFirstRecordByFilter(
		"cards_share_links", "token = {:t}", map[string]any{"t": env.tokLive})
	if err != nil {
		t.Fatalf("find link: %v", err)
	}
	link.Set("is_active", false)
	if err := env.app.Save(link); err != nil {
		t.Fatalf("revoke link: %v", err)
	}

	// No session to expire and no cache to bust: the rule re-reads is_active on
	// every request, so the very next read is already refused.
	if canViewWithToken(t, env.app, env.card, env.tokLive, nil) {
		t.Fatal("a revoked token still reads the card — revocation is not immediate")
	}
}

// Expiry uses the same re-evaluation path as revocation, and the same
// mechanism proves it without a second scenario.
func TestShareToken_ExpiryIsEvaluatedPerRequest(t *testing.T) {
	env := setupShareTokenEnv(t)

	if !canViewWithToken(t, env.app, env.card, env.tokFuture, nil) {
		t.Fatal("a token expiring in the future should be live")
	}

	link, err := env.app.FindFirstRecordByFilter(
		"cards_share_links", "token = {:t}", map[string]any{"t": env.tokFuture})
	if err != nil {
		t.Fatalf("find link: %v", err)
	}
	link.Set("expires_at", time.Now().UTC().Add(-time.Minute).Format("2006-01-02 15:04:05.000Z"))
	if err := env.app.Save(link); err != nil {
		t.Fatalf("expire link: %v", err)
	}

	if canViewWithToken(t, env.app, env.card, env.tokFuture, nil) {
		t.Fatal("an expired token still reads the card")
	}
}

// ---------------------------------------------------------------------------
// Positive controls. The disjunct must not have changed anything for a real
// member, and must not have opened the board to an authenticated non-member.

// Every project role still reads the board with no token in play. If the
// disjunct were ever written so that it REPLACED the membership clause rather
// than joining it, this is what would catch it.
func TestShareToken_MemberAccessUnchanged(t *testing.T) {
	env := setupShareTokenEnv(t)

	for _, tc := range []struct {
		name string
		user *core.Record
	}{
		{"owner", env.owner},
		{"editor", env.editor},
		{"commentor", env.commentor},
		{"viewer", env.viewer},
	} {
		if !canViewWithToken(t, env.app, env.card, "", tc.user) {
			t.Fatalf("%s can no longer read the board without a token", tc.name)
		}
	}
}

func TestShareToken_OutsiderWithoutTokenStillRefused(t *testing.T) {
	env := setupShareTokenEnv(t)

	req{
		method:  http.MethodGet,
		url:     "/api/collections/cards_cards/records",
		token:   env.outsiderToken,
		want:    http.StatusOK,
		content: emptyList,
	}.run(t, env.cardsEnv)
}

// A DISABLED user holding a link reads that board. This looks like a hole and
// is not: anyone with the link can read it, and a disabled user gains nothing a
// logged-out browser would not. What matters is the second half — `enabled`
// still gates the MEMBERSHIP path, so the same disabled user cannot reach a
// board they merely belong to. Asserted so nobody "fixes" the first half and
// silently breaks public boards for everyone.
func TestShareToken_DisabledUserReadsSharedBoardButNotTheirOwn(t *testing.T) {
	env := setupShareTokenEnv(t)

	env.viewer.Set("disabled", true)
	if err := env.app.Save(env.viewer); err != nil {
		t.Fatalf("disable viewer: %v", err)
	}

	// Membership path: closed, because `enabled` is conjoined onto it.
	if canViewWithToken(t, env.app, env.card, "", env.viewer) {
		t.Fatal("a disabled member still reads the board through their membership")
	}

	// Token path: open, and deliberately so.
	if !canViewWithToken(t, env.app, env.card, env.tokLive, env.viewer) {
		t.Fatal("a disabled user holding a live link cannot read the shared board")
	}
}

// ---------------------------------------------------------------------------
// The file blob.
//
// These three tests exist because writing them uncovered a pre-existing hole
// well outside cards: PocketBase consulted the collection's viewRule before
// serving /api/files/... ONLY for a file field marked `protected`
// (apis/file.go, `if fileField.Protected`). No file field in this workspace was
// — not cards', not mail's, not drive's, not text's — so every attachment in
// every package was downloadable by anyone who knew a record id and a filename,
// with no auth at all. 1980000000's own comment asserted the opposite.
//
// Fixed in the vendored fork: the viewRule now gates every file, and
// `protected` means only "ALSO accept a ?token= file token". So the blob path
// now enforces exactly what the record path does, and the cross-board case
// below is a real isolation assertion rather than the characterization of a
// leak it was first written as.

func TestShareToken_ServesSharedBoardFile(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method: http.MethodGet,
		url: fmt.Sprintf("/api/files/cards_attachments/%s/%s",
			env.aAttach.Id, env.aAttach.GetString("file")),
		shareToken: env.tokLive,
		want:       http.StatusOK,
		content:    []string{"attachment body for a-file.txt"},
	}.run(t, env)
}

// The correlation clause again, on the path that hands out actual bytes.
func TestShareToken_DoesNotServeAnotherBoardsFile(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method: http.MethodGet,
		url: fmt.Sprintf("/api/files/cards_attachments/%s/%s",
			env.bAttach.Id, env.bAttach.GetString("file")),
		shareToken: env.tokLive,
		want:       http.StatusNotFound,
	}.run(t, env)
}

// No token at all reaches no bytes at all. This is the regression guard for the
// hole itself: before the fork change this returned the file contents, and it
// is the single assertion that would catch the gate being removed again.
func TestShareToken_ServesNoFileWithoutAToken(t *testing.T) {
	env := setupShareTokenEnv(t)

	anonReq{
		method: http.MethodGet,
		url: fmt.Sprintf("/api/files/cards_attachments/%s/%s",
			env.aAttach.Id, env.aAttach.GetString("file")),
		want: http.StatusNotFound,
	}.run(t, env)
}
