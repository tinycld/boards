package boards

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/guestauth"
	"tinycld.org/core/ratelimit"
)

// Redeeming a share link into a board membership.
//
// This is the WRITE path. Reading a shared board needs none of it — the token
// satisfies the access rules directly (pb-migrations/1980000003). But an
// anonymous visitor cannot write anything: boards_comments.author,
// boards_cards.created_by and boards_attachments.uploaded_by are required
// relations to `users`, and the create rules pin them to @request.auth.id. So
// contributing means becoming someone, and this is where that happens.
//
// The load-bearing design point, inherited from drive and the reason M2's rules
// never mention links: a redeemed link MINTS A MEMBERSHIP ROW. From then on the
// visitor is an ordinary member and the ordinary rules do all the work. The
// token stops being sent (the client clears it on sign-in) and the OTHER half
// of the rule disjunct authorizes them.
//
// The account machinery lives in tinycld.org/core/guestauth; what stays here is
// the part that is boards': which link roles need an account at all, and what a
// redemption grants.

type otpRequestBody struct {
	Email string `json:"email"`
}

type otpVerifyBody struct {
	Email string `json:"email"`
	Code  string `json:"code"`
	OTPID string `json:"otp_id"`
}

// needsSignIn reports whether a link's role implies contributing.
//
// A viewer link is refused by both endpoints: anonymous read is the entire
// grant, so an account would buy the visitor nothing and cost them an email
// address. Refusing is not a limitation — it is the flow declining to collect
// something it has no use for.
func needsSignIn(role string) bool {
	return role == shareRoleCommentor || role == shareRoleEditor
}

// resolveLinkForSignIn loads a live link and checks it admits a sign-in.
//
// Re-resolved on EVERY call, in both endpoints, so revoking or expiring a link
// between request and verify takes effect immediately rather than at the end of
// some session's life.
func resolveLinkForSignIn(app core.App, token string) (*core.Record, *core.Record, int, string) {
	link, project, status, msg := resolveLiveLink(app, token)
	if link == nil {
		return nil, nil, status, msg
	}
	if !needsSignIn(link.GetString("role")) {
		return nil, nil, http.StatusBadRequest, "this link does not require sign-in"
	}
	return link, project, 0, ""
}

// resolveLiveLink loads a link that is real, active and unexpired, plus the
// board it names.
//
// The one place those four checks live. Every public entry point resolves
// through it, so the metadata endpoint and the two OTP endpoints cannot drift
// on what "live" means or on which status a given refusal earns — and the
// statuses are load-bearing beyond this file: the client reads 410-vs-404 to
// decide whether to tell a visitor the link was switched off, lapsed, or never
// existed, and it distinguishes revoked from expired by THIS message text.
//
// Returns a nil link with the status and message to send on any refusal.
func resolveLiveLink(app core.App, token string) (*core.Record, *core.Record, int, string) {
	// Length-checked before the query: the column is a fixed 64 hex chars, so
	// anything else cannot match and should not reach the database.
	if len(token) != 64 {
		return nil, nil, http.StatusNotFound, "share link not found"
	}
	link, err := app.FindFirstRecordByFilter(
		"boards_share_links", "token = {:t}", dbx.Params{"t": token})
	if err != nil || link == nil {
		return nil, nil, http.StatusNotFound, "share link not found"
	}
	if !link.GetBool("is_active") {
		return nil, nil, http.StatusGone, "this link has been revoked"
	}
	expiresAt := link.GetDateTime("expires_at")
	if !expiresAt.IsZero() && expiresAt.Time().Before(nowUTC()) {
		return nil, nil, http.StatusGone, "this link has expired"
	}
	project, err := app.FindRecordById("boards_projects", link.GetString("project"))
	if err != nil || project == nil {
		return nil, nil, http.StatusNotFound, "board not found"
	}
	return link, project, 0, ""
}

// handleShareLinkMetadata tells a visitor what their own link offers.
//
// Public, because the alternative does not work: boards_share_links is
// owner-only by rule, so a visitor reads no row and the client cannot tell an
// editor link from a viewer one. Without this the board renders but never
// offers the sign-in that would let someone contribute — the affordance would
// exist only for people who already have access, which is nobody who needs it.
//
// It discloses strictly less than the link already does: the board's name,
// which the visitor is about to read anyway, and the role, which is what the
// link grants them. Nothing about the roster, the owner, or any other link.
// A wrong or dead token is a 404/410 exactly as it is everywhere else, so this
// is not an oracle for guessing tokens either.
func handleShareLinkMetadata(app core.App, re *core.RequestEvent) error {
	if !shareLinkLimiter.Allow(ratelimit.ClientIP(re.Request)) {
		return re.JSON(http.StatusTooManyRequests,
			shareLinkErrorResponse{Error: "rate limit exceeded"})
	}

	// Note this does NOT go through resolveLinkForSignIn: a viewer link is a
	// perfectly good link and its metadata is what tells the client to offer no
	// sign-in button. Refusing it here would blank the board's title for exactly
	// the most common kind of link.
	link, project, status, msg := resolveLiveLink(app, re.Request.PathValue("token"))
	if link == nil {
		return re.JSON(status, shareLinkErrorResponse{Error: msg})
	}

	return re.JSON(http.StatusOK, map[string]any{
		"role":         link.GetString("role"),
		"project_id":   project.Id,
		"project_name": project.GetString("name"),
		"needs_signin": needsSignIn(link.GetString("role")),
	})
}

// handleShareOTPRequest emails a one-time code to a would-be contributor.
//
// Public and rate-limited hard: a 6-digit code is a ~10^6 keyspace, and at the
// share-wide 60/min a single IP would get ~900 guesses per TTL. 10/min gives
// ~150 — generous for a person, materially tighter for a script.
//
// The code is emailed and NEVER returned in the response. The account is
// created here (PocketBase anchors an OTP to an auth record) but granted
// nothing: an unverified user with no membership has no access, so
// request-but-never-verify leaves nothing behind worth having.
func handleShareOTPRequest(app core.App, re *core.RequestEvent) error {
	if !otpLimiter.Allow(ratelimit.ClientIP(re.Request)) {
		return re.JSON(http.StatusTooManyRequests,
			shareLinkErrorResponse{Error: "rate limit exceeded"})
	}

	link, project, status, msg := resolveLinkForSignIn(app, re.Request.PathValue("token"))
	if link == nil {
		return re.JSON(status, shareLinkErrorResponse{Error: msg})
	}

	var body otpRequestBody
	if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil {
		return re.JSON(http.StatusBadRequest,
			shareLinkErrorResponse{Error: "invalid request body"})
	}
	email, err := guestauth.ParseEmail(body.Email)
	if err != nil {
		return re.JSON(http.StatusBadRequest,
			shareLinkErrorResponse{Error: "invalid email address"})
	}

	user, err := guestauth.FindOrCreateUser(app, email)
	if err != nil {
		return re.InternalServerError("failed to prepare account", err)
	}

	otp, code, err := guestauth.MintOTP(app, user, email)
	if err != nil {
		return re.InternalServerError("failed to mint code", err)
	}

	if err := sendBoardOTPEmail(app, email, code, project.GetString("name")); err != nil {
		// The send failed but the OTP exists. Delete it so the visitor can
		// re-request without tripping a guard, and fail loudly — the code is
		// never leaked into the response as a fallback.
		_ = app.Delete(otp)
		return re.InternalServerError("failed to send code", err)
	}

	// otp_id is an opaque pointer the client echoes back at verify. The code
	// itself only ever travels by email.
	return re.JSON(http.StatusOK, map[string]any{"ok": true, "otp_id": otp.Id})
}

// handleShareOTPVerify exchanges a code for a real session and a membership.
func handleShareOTPVerify(app core.App, re *core.RequestEvent) error {
	if !otpLimiter.Allow(ratelimit.ClientIP(re.Request)) {
		return re.JSON(http.StatusTooManyRequests,
			shareLinkErrorResponse{Error: "rate limit exceeded"})
	}

	link, project, status, msg := resolveLinkForSignIn(app, re.Request.PathValue("token"))
	if link == nil {
		return re.JSON(status, shareLinkErrorResponse{Error: msg})
	}

	var body otpVerifyBody
	if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil {
		return re.JSON(http.StatusBadRequest,
			shareLinkErrorResponse{Error: "invalid request body"})
	}
	email, err := guestauth.ParseEmail(body.Email)
	if err != nil {
		return re.JSON(http.StatusBadRequest,
			shareLinkErrorResponse{Error: "invalid email address"})
	}
	code := strings.TrimSpace(body.Code)
	otpID := strings.TrimSpace(body.OTPID)
	if code == "" || otpID == "" {
		return re.JSON(http.StatusBadRequest,
			shareLinkErrorResponse{Error: "code and otp_id are required"})
	}

	otp, err := guestauth.ConsumeOTP(app, otpID, code, email)
	if err != nil {
		// One uniform message for every rejection, so the otp_id cannot be
		// used as an oracle.
		return re.JSON(http.StatusBadRequest,
			shareLinkErrorResponse{Error: guestauth.ErrBadCode.Error()})
	}

	linkRole := link.GetString("role")
	var provisioned *core.Record

	// One transaction, so a half-provisioned visitor — an account with no
	// membership, or a membership on an unverified account — is not reachable.
	err = app.RunInTransaction(func(txApp core.App) error {
		user, ferr := guestauth.FindOrCreateUser(txApp, email)
		if ferr != nil {
			return fmt.Errorf("guest user: %w", ferr)
		}
		if !user.Verified() {
			user.SetVerified(true)
			if serr := txApp.Save(user); serr != nil {
				return fmt.Errorf("verify user: %w", serr)
			}
		}
		if ferr := guestauth.EnsureGuestRole(txApp, user); ferr != nil {
			return fmt.Errorf("guest role: %w", ferr)
		}
		if ferr := findOrCreateProjectMembership(
			txApp, project.Id, user.Id, linkRole,
		); ferr != nil {
			return fmt.Errorf("board membership: %w", ferr)
		}
		// Consumed LAST: a transient failure above must leave the visitor
		// their code so they can retry inside the TTL.
		if derr := txApp.Delete(otp); derr != nil {
			return fmt.Errorf("consume otp: %w", derr)
		}
		provisioned = user
		return nil
	})
	if err != nil {
		return re.InternalServerError("failed to join the board", err)
	}

	// Re-read outside the transaction so PublicExport carries the committed
	// verified state.
	live, err := app.FindRecordById("users", provisioned.Id)
	if err != nil {
		return re.InternalServerError("failed to load account", err)
	}
	token, err := live.NewAuthToken()
	if err != nil {
		return re.InternalServerError("failed to mint auth token", err)
	}

	// Shaped like PocketBase's own auth response so the client can hand it
	// straight to pb.authStore.save.
	return re.JSON(http.StatusOK, map[string]any{
		"token":      token,
		"record":     live.PublicExport(),
		"project_id": project.Id,
	})
}

// findOrCreateProjectMembership mints the row that IS the grant.
//
// Runs with rules bypassed, inside the caller's transaction. It has to: the
// visitor is nobody yet, and no rule can express "a valid link admitted this
// person" — which is exactly why redemption is Go and reading is not.
//
// NEVER UPGRADES an existing membership. The link's role is a CEILING, not a
// grant: an editor link must not promote someone an owner deliberately added as
// a viewer, and a viewer link must not demote an editor. An existing row is
// returned untouched.
//
// The role can never be owner — boards_share_links.role's enum has no such
// value, and the guard below is belt-and-braces against a future caller. That
// also keeps this clear of the last-owner guard, which binds OnRecord*Request
// events that app.Save inside a transaction does not fire.
func findOrCreateProjectMembership(app core.App, projectID, userID, role string) error {
	if role == "owner" {
		return fmt.Errorf("a share link may never grant ownership")
	}

	existing, _ := app.FindFirstRecordByFilter(
		"boards_project_members",
		"project = {:p} && user = {:u}",
		dbx.Params{"p": projectID, "u": userID},
	)
	if existing != nil {
		return nil
	}

	col, err := app.FindCollectionByNameOrId("boards_project_members")
	if err != nil {
		return fmt.Errorf("members collection: %w", err)
	}
	rec := core.NewRecord(col)
	rec.Set("project", projectID)
	rec.Set("user", userID)
	rec.Set("role", role)
	if err := app.Save(rec); err != nil {
		// Race: a concurrent verify created it. The unique index on
		// (project, user) is the backstop.
		if again, _ := app.FindFirstRecordByFilter(
			"boards_project_members",
			"project = {:p} && user = {:u}",
			dbx.Params{"p": projectID, "u": userID},
		); again != nil {
			return nil
		}
		return fmt.Errorf("create membership: %w", err)
	}
	return nil
}

// sendBoardOTPEmail delivers the code.
//
// The subject names the BOARD, because a bare code in an inbox reads like
// phishing and the recipient needs to recognise what they are joining. The body
// carries the code and nothing else — no link, no second token: the visitor
// already has the board open in front of them.
func sendBoardOTPEmail(app core.App, toEmail, code, boardName string) error {
	if boardName == "" {
		boardName = "a shared board"
	}
	// The app handle is unused today; kept on the signature so per-app routing
	// (suppressing mail for a demo tenant, say) can land without churn here.
	_ = app
	return guestauth.SendCode(
		context.Background(),
		fmt.Sprintf("Your code to join %q", boardName),
		fmt.Sprintf("Use this code to join %s:", boardName),
		toEmail,
		code,
	)
}

// nowUTC is a seam for the expiry comparison above.
func nowUTC() time.Time {
	return time.Now().UTC()
}
