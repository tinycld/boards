package cards

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/guestauth"
)

// Redeeming a share link into a board membership.
//
// The two that matter most, and the reason this file exists:
//
//   - a redemption NEVER UPGRADES an existing membership. The link's role is a
//     ceiling, not a grant. If an editor link could promote someone an owner
//     deliberately added as a viewer, the roster would stop meaning anything.
//   - a redemption NEVER MINTS AN OWNER. A link must not be able to hand away
//     the board.
//
// Everything else here is about who is refused and what is left behind when
// they are.

func init() {
	// Defensive: the mailer is LogSender in tests, but a misconfigured
	// environment must never actually send during a suite run.
	_ = os.Setenv("SKIP_SENDING_MAIL", "true")
}

// otpEnv captures the plaintext code, which is otherwise unreadable — PB hashes
// it before it is persisted, so the only moment it exists in the clear is on the
// in-memory record during the save.
type otpEnv struct {
	*cardsEnv
	mu       sync.Mutex
	lastCode string
}

func setupOTPEnv(t *testing.T) *otpEnv {
	t.Helper()
	env := &otpEnv{cardsEnv: setupCardsEnv(t)}

	// Every test in this file shares one httptest RemoteAddr, so without a
	// reset the tenth case starts with nine strikes and fails for reasons that
	// have nothing to do with what it tests.
	otpLimiter.Reset()
	shareLinkLimiter.Reset()

	env.app.OnRecordCreate("_otps").BindFunc(func(e *core.RecordEvent) error {
		env.mu.Lock()
		env.lastCode = e.Record.GetString("password")
		env.mu.Unlock()
		return e.Next()
	})

	return env
}

func (e *otpEnv) code() string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.lastCode
}

func otpBody(email string) string {
	return fmt.Sprintf(`{"email":%q}`, email)
}

func verifyBody(email, code, otpID string) string {
	return fmt.Sprintf(`{"email":%q,"code":%q,"otp_id":%q}`, email, code, otpID)
}

func memberRole(t testing.TB, app *tests.TestApp, projectID, userID string) string {
	row, err := app.FindFirstRecordByFilter("cards_project_members",
		"project = {:p} && user = {:u}", dbx.Params{"p": projectID, "u": userID})
	if err != nil || row == nil {
		return ""
	}
	return row.GetString("role")
}

func userByEmail(t testing.TB, app *tests.TestApp, email string) *core.Record {
	col, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("users collection: %v", err)
	}
	rec, err := app.FindAuthRecordByEmail(col, email)
	if err != nil {
		return nil
	}
	return rec
}

// --------------------------------------------------------------------------
// Requesting a code.

func TestShareOTP_EditorLinkMintsACode(t *testing.T) {
	env := setupOTPEnv(t)
	tok := shareLink(t, env.cardsEnv, env.project.Id, tok64("otpeditor"), "editor", true, "")

	mintReq{
		method:  http.MethodPost,
		url:     "/api/cards/share-link/" + tok + "/otp-request",
		body:    otpBody("newcomer@test.local"),
		want:    http.StatusOK,
		content: []string{`"otp_id"`},
		after: func(t testing.TB, app *tests.TestApp) {
			// The account exists but is granted NOTHING until a code is
			// verified: unverified, and no membership. So
			// request-but-never-verify leaves nothing worth having.
			user := userByEmail(t, app, "newcomer@test.local")
			if user == nil {
				t.Fatal("no account was prepared for the requester")
			}
			if user.Verified() {
				t.Fatal("the account is verified before any code was proven")
			}
			if role := memberRole(t, app, env.project.Id, user.Id); role != "" {
				t.Fatalf("a membership (%q) was granted before verification", role)
			}
		},
	}.run(t, env.cardsEnv)
}

// The code must never travel in the HTTP response — only by email.
//
// Asserted against the captured body rather than through `notContent`: that
// field is evaluated when the request struct is BUILT, and the code does not
// exist until the request has run. The obvious spelling of this test passes
// unconditionally — it asserts the absence of the empty string.
func TestShareOTP_CodeIsNeverInTheResponse(t *testing.T) {
	env := setupOTPEnv(t)
	tok := shareLink(t, env.cardsEnv, env.project.Id, tok64("otpsecret"), "commentor", true, "")

	var body string
	scenario := &tests.ApiScenario{
		Name:   "otp-request must not echo the code",
		Method: http.MethodPost,
		URL:    "/api/cards/share-link/" + tok + "/otp-request",
		Body:   strings.NewReader(otpBody("secret@test.local")),
		Headers: map[string]string{
			"Content-Type": "application/json",
		},
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"otp_id"`},
		TestAppFactory:  func(testing.TB) *tests.TestApp { return env.app },
		BeforeTestFunc: func(_ testing.TB, _ *tests.TestApp, e *core.ServeEvent) {
			bindShareLinkRoutes(e)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			raw, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("read body: %v", err)
			}
			body = string(raw)
		},
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)

	code := env.code()
	if code == "" {
		t.Fatal("no code was minted, so this assertion would prove nothing")
	}
	if strings.Contains(body, code) {
		t.Fatalf("the response leaked the code: %s", body)
	}
}

// A viewer link needs no account, so asking for one is refused rather than
// quietly collecting an email address the flow has no use for.
func TestShareOTP_ViewerLinkRefusesSignIn(t *testing.T) {
	env := setupOTPEnv(t)
	tok := shareLink(t, env.cardsEnv, env.project.Id, tok64("otpviewer"), "viewer", true, "")

	mintReq{
		method:  http.MethodPost,
		url:     "/api/cards/share-link/" + tok + "/otp-request",
		body:    otpBody("nobody@test.local"),
		want:    http.StatusBadRequest,
		content: []string{`"error"`},
		after: func(t testing.TB, app *tests.TestApp) {
			if userByEmail(t, app, "nobody@test.local") != nil {
				t.Fatal("an account was created for a link that needs none")
			}
		},
	}.run(t, env.cardsEnv)
}

func TestShareOTP_RevokedLinkRefusesSignIn(t *testing.T) {
	env := setupOTPEnv(t)
	tok := shareLink(t, env.cardsEnv, env.project.Id, tok64("otprevoked"), "editor", false, "")

	mintReq{
		method:  http.MethodPost,
		url:     "/api/cards/share-link/" + tok + "/otp-request",
		body:    otpBody("nobody2@test.local"),
		want:    http.StatusGone,
		content: []string{`"error"`},
	}.run(t, env.cardsEnv)
}

func TestShareOTP_InvalidEmailIsRefused(t *testing.T) {
	env := setupOTPEnv(t)
	tok := shareLink(t, env.cardsEnv, env.project.Id, tok64("otpbademail"), "editor", true, "")

	mintReq{
		method:  http.MethodPost,
		url:     "/api/cards/share-link/" + tok + "/otp-request",
		body:    otpBody("not-an-address"),
		want:    http.StatusBadRequest,
		content: []string{`"error"`},
	}.run(t, env.cardsEnv)
}

// --------------------------------------------------------------------------
// Verifying, and what a redemption grants.

func TestShareOTP_VerifyMintsMembershipAtTheLinkRole(t *testing.T) {
	env := setupOTPEnv(t)
	tok := shareLink(t, env.cardsEnv, env.project.Id, tok64("otpjoin"), "editor", true, "")
	otpID := requestCode(t, env, tok, "joiner@test.local")

	mintReq{
		method:  http.MethodPost,
		url:     "/api/cards/share-link/" + tok + "/otp-verify",
		body:    verifyBody("joiner@test.local", env.code(), otpID),
		want:    http.StatusOK,
		content: []string{`"token"`, `"record"`},
		after: func(t testing.TB, app *tests.TestApp) {
			user := userByEmail(t, app, "joiner@test.local")
			if user == nil {
				t.Fatal("no account after a verified code")
			}
			if !user.Verified() {
				t.Fatal("the account is still unverified after proving the email")
			}
			if got := user.GetString("role"); got != "guest" {
				t.Fatalf("org role = %q, want guest", got)
			}
			if got := memberRole(t, app, env.project.Id, user.Id); got != "editor" {
				t.Fatalf("board role = %q, want the link's editor", got)
			}
		},
	}.run(t, env.cardsEnv)
}

// THE assertion. The link's role is a ceiling, not a grant.
func TestShareOTP_VerifyNeverUpgradesAnExistingMembership(t *testing.T) {
	env := setupOTPEnv(t)
	// The viewer is already on the board, deliberately placed there by an owner.
	tok := shareLink(t, env.cardsEnv, env.project.Id, tok64("otpupgrade"), "editor", true, "")
	otpID := requestCode(t, env, tok, env.viewer.Email())

	mintReq{
		method:  http.MethodPost,
		url:     "/api/cards/share-link/" + tok + "/otp-verify",
		body:    verifyBody(env.viewer.Email(), env.code(), otpID),
		want:    http.StatusOK,
		content: []string{`"token"`},
		after: func(t testing.TB, app *tests.TestApp) {
			if got := memberRole(t, app, env.project.Id, env.viewer.Id); got != "viewer" {
				t.Fatalf("an editor link promoted a viewer to %q", got)
			}
		},
	}.run(t, env.cardsEnv)
}

// The mirror: a viewer link must not demote someone who is already an editor.
func TestShareOTP_VerifyNeverDowngradesAnExistingMembership(t *testing.T) {
	env := setupOTPEnv(t)
	tok := shareLink(t, env.cardsEnv, env.project.Id, tok64("otpdowngrade"), "commentor", true, "")
	otpID := requestCode(t, env, tok, env.editor.Email())

	mintReq{
		method:  http.MethodPost,
		url:     "/api/cards/share-link/" + tok + "/otp-verify",
		body:    verifyBody(env.editor.Email(), env.code(), otpID),
		want:    http.StatusOK,
		content: []string{`"token"`},
		after: func(t testing.TB, app *tests.TestApp) {
			if got := memberRole(t, app, env.project.Id, env.editor.Id); got != "editor" {
				t.Fatalf("a commentor link changed an editor to %q", got)
			}
		},
	}.run(t, env.cardsEnv)
}

// An existing org member who redeems a link keeps their org role — visiting a
// board must not demote an owner or admin to guest.
func TestShareOTP_VerifyNeverDemotesAnOrgMemberToGuest(t *testing.T) {
	env := setupOTPEnv(t)
	tok := shareLink(t, env.cardsEnv, env.project.Id, tok64("otporgrole"), "editor", true, "")
	otpID := requestCode(t, env, tok, env.outsider.Email())

	mintReq{
		method:  http.MethodPost,
		url:     "/api/cards/share-link/" + tok + "/otp-verify",
		body:    verifyBody(env.outsider.Email(), env.code(), otpID),
		want:    http.StatusOK,
		content: []string{`"token"`},
		after: func(t testing.TB, app *tests.TestApp) {
			user := userByEmail(t, app, env.outsider.Email())
			if got := user.GetString("role"); got != "member" {
				t.Fatalf("org role = %q, want the pre-existing member", got)
			}
			// They DO gain the board, which is the point of redeeming.
			if got := memberRole(t, app, env.project.Id, user.Id); got != "editor" {
				t.Fatalf("board role = %q, want editor", got)
			}
		},
	}.run(t, env.cardsEnv)
}

func TestShareOTP_WrongCodeIsRefused(t *testing.T) {
	env := setupOTPEnv(t)
	tok := shareLink(t, env.cardsEnv, env.project.Id, tok64("otpwrong"), "editor", true, "")
	otpID := requestCode(t, env, tok, "wrong@test.local")

	mintReq{
		method:  http.MethodPost,
		url:     "/api/cards/share-link/" + tok + "/otp-verify",
		body:    verifyBody("wrong@test.local", "000000", otpID),
		want:    http.StatusBadRequest,
		content: []string{`"error"`},
		after: func(t testing.TB, app *tests.TestApp) {
			user := userByEmail(t, app, "wrong@test.local")
			if user == nil {
				return
			}
			if role := memberRole(t, app, env.project.Id, user.Id); role != "" {
				t.Fatalf("a wrong code still granted %q", role)
			}
		},
	}.run(t, env.cardsEnv)
}

// A wrong email against a known otp_id burns the OTP, so a leaked opaque id
// cannot be retried against address after address.
func TestShareOTP_WrongEmailBurnsTheCode(t *testing.T) {
	env := setupOTPEnv(t)
	tok := shareLink(t, env.cardsEnv, env.project.Id, tok64("otpburn"), "editor", true, "")
	otpID := requestCode(t, env, tok, "burn@test.local")

	mintReq{
		method:  http.MethodPost,
		url:     "/api/cards/share-link/" + tok + "/otp-verify",
		body:    verifyBody("attacker@test.local", env.code(), otpID),
		want:    http.StatusBadRequest,
		content: []string{`"error"`},
		after: func(t testing.TB, app *tests.TestApp) {
			if _, err := app.FindOTPById(otpID); err == nil {
				t.Fatal("the OTP survived a wrong-email attempt")
			}
		},
	}.run(t, env.cardsEnv)
}

// Revoking between request and verify takes effect immediately — the link is
// re-resolved on the verify call rather than trusted from the request.
func TestShareOTP_RevokedBetweenRequestAndVerify(t *testing.T) {
	env := setupOTPEnv(t)
	tok := shareLink(t, env.cardsEnv, env.project.Id, tok64("otpmidrevoke"), "editor", true, "")
	otpID := requestCode(t, env, tok, "midrevoke@test.local")

	link, err := env.app.FindFirstRecordByFilter("cards_share_links",
		"token = {:t}", dbx.Params{"t": tok})
	if err != nil {
		t.Fatalf("find link: %v", err)
	}
	link.Set("is_active", false)
	if err := env.app.Save(link); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	mintReq{
		method:  http.MethodPost,
		url:     "/api/cards/share-link/" + tok + "/otp-verify",
		body:    verifyBody("midrevoke@test.local", env.code(), otpID),
		want:    http.StatusGone,
		content: []string{`"error"`},
		after: func(t testing.TB, app *tests.TestApp) {
			user := userByEmail(t, app, "midrevoke@test.local")
			if user == nil {
				return
			}
			if role := memberRole(t, app, env.project.Id, user.Id); role != "" {
				t.Fatalf("a revoked link still granted %q", role)
			}
		},
	}.run(t, env.cardsEnv)
}

// The code is single-use: replaying a verified one must not work.
func TestShareOTP_CodeIsConsumedOnSuccess(t *testing.T) {
	env := setupOTPEnv(t)
	tok := shareLink(t, env.cardsEnv, env.project.Id, tok64("otponce"), "editor", true, "")
	otpID := requestCode(t, env, tok, "once@test.local")

	mintReq{
		method:  http.MethodPost,
		url:     "/api/cards/share-link/" + tok + "/otp-verify",
		body:    verifyBody("once@test.local", env.code(), otpID),
		want:    http.StatusOK,
		content: []string{`"token"`},
		after: func(t testing.TB, app *tests.TestApp) {
			if _, err := app.FindOTPById(otpID); err == nil {
				t.Fatal("the code survived a successful verify and can be replayed")
			}
		},
	}.run(t, env.cardsEnv)
}

// --------------------------------------------------------------------------
// The guard that cannot be reached through an endpoint, asserted directly.

func TestShareOTP_MembershipMintingRefusesOwner(t *testing.T) {
	env := setupOTPEnv(t)

	// Unreachable via HTTP — the role enum has no owner and the mint endpoint
	// rejects it — so this calls the provisioning helper directly. It is the
	// backstop for a future caller that forgets, and the failure it prevents
	// (a link handing away the board) is the worst one in the feature.
	err := findOrCreateProjectMembership(env.app, env.project.Id, env.outsider.Id, "owner")
	if err == nil {
		t.Fatal("provisioning accepted the owner role")
	}
	if role := memberRole(t, env.app, env.project.Id, env.outsider.Id); role != "" {
		t.Fatalf("an owner membership (%q) was written anyway", role)
	}
}

// requestCode drives otp-request directly (not through ApiScenario, which a
// Test function may use only once) and returns the otp_id.
func requestCode(t *testing.T, env *otpEnv, token, email string) string {
	t.Helper()

	link, project, status, msg := resolveLinkForSignIn(env.app, token)
	if link == nil {
		t.Fatalf("resolve link for %s: %d %s", email, status, msg)
	}
	user, err := guestauth.FindOrCreateUser(env.app, email)
	if err != nil {
		t.Fatalf("prepare account: %v", err)
	}
	otp, code, err := guestauth.MintOTP(env.app, user, email)
	if err != nil {
		t.Fatalf("mint code: %v", err)
	}
	env.mu.Lock()
	env.lastCode = code
	env.mu.Unlock()
	_ = project
	return otp.Id
}
