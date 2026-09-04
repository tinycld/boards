package boards

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// The owner-facing share-link endpoints.
//
// These are the only place cards mints a credential, so most of what follows is
// about who may NOT call them. The collection's rules are owner-only in all
// five directions, but these handlers bypass rules entirely (Go DAO calls do
// not evaluate them), so the ownership check is restated in Go — and the tests
// have to prove the restatement, not the rule.
//
// One ApiScenario per Test function, as everywhere in this package.

// hexToken matches the shape the column requires and the entropy the handler
// promises.
var hexToken = regexp.MustCompile(`^[0-9a-f]{64}$`)

// mintReq drives an authenticated JSON request.
type mintReq struct {
	method     string
	url        string
	token      string
	body       string
	want       int
	content    []string
	notContent []string
	after      func(t testing.TB, app *tests.TestApp)
}

func (r mintReq) run(t *testing.T, env *cardsEnv) {
	t.Helper()
	req{
		method:     r.method,
		url:        r.url,
		token:      r.token,
		body:       r.body,
		want:       r.want,
		content:    r.content,
		notContent: r.notContent,
		after:      r.after,
		before:     bindShareLinkRoutes,
	}.run(t, env)
}

func mintBody(projectID, role string, days int) string {
	return fmt.Sprintf(`{"project_id":%q,"role":%q,"expires_in_days":%d}`,
		projectID, role, days)
}

// countLinks is the "nothing was written" check every refusal needs: a status
// assertion alone would pass even if the row had landed before the error.
func countLinks(t testing.TB, app *tests.TestApp, projectID string) int {
	n, err := app.CountRecords("boards_share_links", dbx.HashExp{"project": projectID})
	if err != nil {
		t.Fatalf("count links: %v", err)
	}
	return int(n)
}

func requireNoLinks(projectID string) func(testing.TB, *tests.TestApp) {
	return func(t testing.TB, app *tests.TestApp) {
		if n := countLinks(t, app, projectID); n != 0 {
			t.Fatalf("%d share link(s) were created despite the refusal", n)
		}
	}
}

// --------------------------------------------------------------------------
// Minting.

func TestShareLinks_OwnerMintsAViewerLink(t *testing.T) {
	env := setupCardsEnv(t)

	mintReq{
		method:  http.MethodPost,
		url:     "/api/boards/share-link",
		token:   env.ownerToken,
		body:    mintBody(env.project.Id, "viewer", 7),
		want:    http.StatusOK,
		content: []string{`"token":"`, `"role":"viewer"`, `"is_active":true`},
		after: func(t testing.TB, app *tests.TestApp) {
			links, err := app.FindRecordsByFilter("boards_share_links",
				"project = {:p}", "", 0, 0, dbx.Params{"p": env.project.Id})
			if err != nil || len(links) != 1 {
				t.Fatalf("expected exactly one link, got %d (err %v)", len(links), err)
			}
			l := links[0]
			if got := l.GetString("token"); !hexToken.MatchString(got) {
				t.Fatalf("token %q is not 64 hex chars — 32 bytes of entropy", got)
			}
			if got := l.GetString("role"); got != "viewer" {
				t.Fatalf("role = %q, want viewer", got)
			}
			if !l.GetBool("is_active") {
				t.Fatal("a freshly minted link is not active")
			}
			if l.GetString("expires_at") == "" {
				t.Fatal("expires_in_days 7 stored no expiry")
			}
			if got := l.GetString("created_by"); got != env.owner.Id {
				t.Fatalf("created_by = %q, want the minting owner", got)
			}
		},
	}.run(t, env)
}

// Two mints must not collide. The tokens are random, so this is really a check
// that nothing memoizes or reuses them.
func TestShareLinks_EachMintGetsADistinctToken(t *testing.T) {
	env := setupCardsEnv(t)

	mintReq{
		method:  http.MethodPost,
		url:     "/api/boards/share-link",
		token:   env.ownerToken,
		body:    mintBody(env.project.Id, "editor", 0),
		want:    http.StatusOK,
		content: []string{`"role":"editor"`},
		after: func(t testing.TB, app *tests.TestApp) {
			// Mint the second one directly; a Test function may drive only one
			// ApiScenario, and what matters here is the pair, not the route.
			first, err := app.FindFirstRecordByFilter("boards_share_links",
				"project = {:p}", dbx.Params{"p": env.project.Id})
			if err != nil {
				t.Fatalf("read first link: %v", err)
			}
			second, err := newShareToken()
			if err != nil {
				t.Fatalf("mint second token: %v", err)
			}
			if first.GetString("token") == second {
				t.Fatal("two mints produced the same token")
			}
			if !hexToken.MatchString(second) {
				t.Fatalf("second token %q is malformed", second)
			}
			// `never` stores the empty string, which is the branch the rule's
			// `expires_at ?= ""` matches.
			if got := first.GetString("expires_at"); got != "" {
				t.Fatalf("expires_in_days 0 stored %q, want empty (never)", got)
			}
		},
	}.run(t, env)
}

func TestShareLinks_EditorCannotMint(t *testing.T) {
	env := setupCardsEnv(t)

	mintReq{
		method: http.MethodPost,
		url:    "/api/boards/share-link",
		token:  env.editorToken,
		body:   mintBody(env.project.Id, "viewer", 7),
		want:   http.StatusForbidden,
		after:  requireNoLinks(env.project.Id),
	}.run(t, env)
}

func TestShareLinks_CommentorCannotMint(t *testing.T) {
	env := setupCardsEnv(t)

	mintReq{
		method: http.MethodPost,
		url:    "/api/boards/share-link",
		token:  env.commentorToken,
		body:   mintBody(env.project.Id, "viewer", 7),
		want:   http.StatusForbidden,
		after:  requireNoLinks(env.project.Id),
	}.run(t, env)
}

func TestShareLinks_ViewerCannotMint(t *testing.T) {
	env := setupCardsEnv(t)

	mintReq{
		method: http.MethodPost,
		url:    "/api/boards/share-link",
		token:  env.viewerToken,
		body:   mintBody(env.project.Id, "viewer", 7),
		want:   http.StatusForbidden,
		after:  requireNoLinks(env.project.Id),
	}.run(t, env)
}

func TestShareLinks_NonMemberCannotMint(t *testing.T) {
	env := setupCardsEnv(t)

	mintReq{
		method: http.MethodPost,
		url:    "/api/boards/share-link",
		token:  env.outsiderToken,
		body:   mintBody(env.project.Id, "viewer", 7),
		want:   http.StatusForbidden,
		after:  requireNoLinks(env.project.Id),
	}.run(t, env)
}

func TestShareLinks_AnonymousCannotMint(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/boards/share-link",
		body:   mintBody(env.project.Id, "viewer", 7),
		want:   http.StatusUnauthorized,
		after:  requireNoLinks(env.project.Id),
		before: bindShareLinkRoutes,
	}.run(t, env)
}

// An unknown role is REFUSED, not silently coerced to viewer. Drive coerces,
// which is how a UI bug ships as "the link works, just not as asked".
func TestShareLinks_UnknownRoleIsRefused(t *testing.T) {
	env := setupCardsEnv(t)

	mintReq{
		method: http.MethodPost,
		url:    "/api/boards/share-link",
		token:  env.ownerToken,
		body:   mintBody(env.project.Id, "admin", 7),
		want:   http.StatusBadRequest,
		after:  requireNoLinks(env.project.Id),
	}.run(t, env)
}

// `owner` is not in the column's enum and must not be mintable: a link may
// never confer ownership of a board.
func TestShareLinks_OwnerRoleIsNotMintable(t *testing.T) {
	env := setupCardsEnv(t)

	mintReq{
		method: http.MethodPost,
		url:    "/api/boards/share-link",
		token:  env.ownerToken,
		body:   mintBody(env.project.Id, "owner", 7),
		want:   http.StatusBadRequest,
		after:  requireNoLinks(env.project.Id),
	}.run(t, env)
}

// An arbitrary duration is refused. The set is closed because the UI offers
// exactly these, so anything else is a client bug or a probe.
func TestShareLinks_UnsupportedExpiryIsRefused(t *testing.T) {
	env := setupCardsEnv(t)

	mintReq{
		method: http.MethodPost,
		url:    "/api/boards/share-link",
		token:  env.ownerToken,
		body:   mintBody(env.project.Id, "viewer", 3650),
		want:   http.StatusBadRequest,
		after:  requireNoLinks(env.project.Id),
	}.run(t, env)
}

// --------------------------------------------------------------------------
// Listing.

func TestShareLinks_OwnerListsTheirBoardsLinks(t *testing.T) {
	env := setupCardsEnv(t)
	tok := shareLink(t, env, env.project.Id, tok64("listme"), "viewer", true, "")

	mintReq{
		method:  http.MethodGet,
		url:     "/api/boards/share-links?project_id=" + env.project.Id,
		token:   env.ownerToken,
		want:    http.StatusOK,
		content: []string{tok},
	}.run(t, env)
}

func TestShareLinks_EditorCannotListLinks(t *testing.T) {
	env := setupCardsEnv(t)
	tok := shareLink(t, env, env.project.Id, tok64("hidden"), "viewer", true, "")

	// The token is the credential, so a non-owner reading the list would be
	// reading a credential they cannot mint.
	mintReq{
		method:     http.MethodGet,
		url:        "/api/boards/share-links?project_id=" + env.project.Id,
		token:      env.editorToken,
		want:       http.StatusForbidden,
		notContent: []string{tok},
	}.run(t, env)
}

// --------------------------------------------------------------------------
// Revoking.

func TestShareLinks_OwnerRevokes(t *testing.T) {
	env := setupCardsEnv(t)
	shareLink(t, env, env.project.Id, tok64("revokeme"), "viewer", true, "")
	link, err := env.app.FindFirstRecordByFilter("boards_share_links",
		"project = {:p}", dbx.Params{"p": env.project.Id})
	if err != nil {
		t.Fatalf("find link: %v", err)
	}

	mintReq{
		method:  http.MethodDelete,
		url:     "/api/boards/share-link/" + link.Id,
		token:   env.ownerToken,
		want:    http.StatusOK,
		content: []string{`"is_active":false`},
		after: func(t testing.TB, app *tests.TestApp) {
			fresh, err := app.FindRecordById("boards_share_links", link.Id)
			if err != nil {
				t.Fatalf("re-read link: %v", err)
			}
			if fresh.GetBool("is_active") {
				t.Fatal("the link is still active after a revoke")
			}
			// A soft flip: the row and its token survive, so revoking is
			// reversible and the audit trail stays intact.
			if fresh.GetString("token") == "" {
				t.Fatal("revoking destroyed the token rather than deactivating it")
			}
		},
	}.run(t, env)
}

func TestShareLinks_EditorCannotRevoke(t *testing.T) {
	env := setupCardsEnv(t)
	shareLink(t, env, env.project.Id, tok64("keepme"), "viewer", true, "")
	link, err := env.app.FindFirstRecordByFilter("boards_share_links",
		"project = {:p}", dbx.Params{"p": env.project.Id})
	if err != nil {
		t.Fatalf("find link: %v", err)
	}

	mintReq{
		method: http.MethodDelete,
		url:    "/api/boards/share-link/" + link.Id,
		token:  env.editorToken,
		want:   http.StatusNotFound,
		after: func(t testing.TB, app *tests.TestApp) {
			fresh, err := app.FindRecordById("boards_share_links", link.Id)
			if err != nil {
				t.Fatalf("re-read link: %v", err)
			}
			if !fresh.GetBool("is_active") {
				t.Fatal("an editor revoked a link they do not own")
			}
		},
	}.run(t, env)
}

// --------------------------------------------------------------------------
// visibility, the decorative badge.

func TestShareLinks_MintingFlipsVisibilityToLink(t *testing.T) {
	env := setupCardsEnv(t)

	mintReq{
		method:  http.MethodPost,
		url:     "/api/boards/share-link",
		token:   env.ownerToken,
		body:    mintBody(env.project.Id, "viewer", 30),
		want:    http.StatusOK,
		content: []string{`"is_active":true`},
		after: func(t testing.TB, app *tests.TestApp) {
			p, err := app.FindRecordById("boards_projects", env.project.Id)
			if err != nil {
				t.Fatalf("re-read project: %v", err)
			}
			if got := p.GetString("visibility"); got != "link" {
				t.Fatalf("visibility = %q, want link", got)
			}
		},
	}.run(t, env)
}

func TestShareLinks_RevokingTheLastLinkRestoresPrivate(t *testing.T) {
	env := setupCardsEnv(t)
	shareLink(t, env, env.project.Id, tok64("solo"), "viewer", true, "")
	syncProjectVisibility(env.app, env.project.Id)
	link, err := env.app.FindFirstRecordByFilter("boards_share_links",
		"project = {:p}", dbx.Params{"p": env.project.Id})
	if err != nil {
		t.Fatalf("find link: %v", err)
	}

	mintReq{
		method:  http.MethodDelete,
		url:     "/api/boards/share-link/" + link.Id,
		token:   env.ownerToken,
		want:    http.StatusOK,
		content: []string{`"is_active":false`},
		after: func(t testing.TB, app *tests.TestApp) {
			p, err := app.FindRecordById("boards_projects", env.project.Id)
			if err != nil {
				t.Fatalf("re-read project: %v", err)
			}
			if got := p.GetString("visibility"); got != "private" {
				t.Fatalf("visibility = %q, want private once the last link is revoked", got)
			}
		},
	}.run(t, env)
}

// --------------------------------------------------------------------------
// The minted token actually works.
//
// The unit above proves a well-formed row; this proves the row the endpoint
// writes satisfies the RULE — the two could drift (a wrong role string, an
// expiry in the wrong format) and every other test here would still pass.

func TestShareLinks_AMintedTokenReadsTheBoard(t *testing.T) {
	env := setupCardsEnv(t)

	mintReq{
		method:  http.MethodPost,
		url:     "/api/boards/share-link",
		token:   env.ownerToken,
		body:    mintBody(env.project.Id, "viewer", 7),
		want:    http.StatusOK,
		content: []string{`"token":"`},
		after: func(t testing.TB, app *tests.TestApp) {
			link, err := app.FindFirstRecordByFilter("boards_share_links",
				"project = {:p}", dbx.Params{"p": env.project.Id})
			if err != nil {
				t.Fatalf("read minted link: %v", err)
			}
			info := &core.RequestInfo{
				Context: core.RequestInfoContextDefault,
				Method:  http.MethodGet,
				Headers: map[string]string{"x_share_token": link.GetString("token")},
				Query:   map[string]string{},
			}
			ok, err := app.CanAccessRecord(env.card, info, env.card.Collection().ViewRule)
			if err != nil {
				t.Fatalf("evaluate viewRule: %v", err)
			}
			if !ok {
				t.Fatal("a freshly minted token cannot read the board it was minted for")
			}
		},
	}.run(t, env)
}

// The response hands the caller the token, which the dialog needs to build a
// URL. Asserted because a redaction added later would break the whole flow in
// a way no rule test would notice.
func TestShareLinks_ResponseCarriesTheToken(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method:  http.MethodPost,
		url:     "/api/boards/share-link",
		token:   env.ownerToken,
		body:    mintBody(env.project.Id, "commentor", 90),
		want:    http.StatusOK,
		content: []string{`"role":"commentor"`},
		before:  bindShareLinkRoutes,
		after: func(t testing.TB, app *tests.TestApp) {
			link, err := app.FindFirstRecordByFilter("boards_share_links",
				"project = {:p}", dbx.Params{"p": env.project.Id})
			if err != nil {
				t.Fatalf("read link: %v", err)
			}
			var got shareLinkResponse
			if err := json.Unmarshal([]byte(fmt.Sprintf(
				`{"id":%q,"token":%q,"role":%q,"expires_at":%q,"is_active":%t,"created":%q}`,
				link.Id, link.GetString("token"), link.GetString("role"),
				link.GetString("expires_at"), link.GetBool("is_active"),
				link.GetString("created"))), &got); err != nil {
				t.Fatalf("shape: %v", err)
			}
			if got.Role != "commentor" {
				t.Fatalf("role = %q, want commentor", got.Role)
			}
		},
	}.run(t, env)
}
