package boards

import (
	"encoding/json"
	"net/http"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/ratelimit"
)

// Owner-facing share-link management: mint, list, update, revoke.
//
// These are the only cards endpoints that write a share link. The read path
// needs no endpoint at all — pb-migrations/1980000003 lets a visitor's token
// satisfy the ordinary collection rules, so a public board is served by the
// same REST and realtime a member uses.
//
// All four require auth AND project ownership. The collection's own rules are
// owner-only in all five directions, and these handlers bypass them (Go DAO
// calls do not evaluate rules), so the ownership check is restated here rather
// than inherited. Minting a link widens access to a whole board; an editor must
// not be able to do it.

type createShareLinkRequest struct {
	ProjectID string `json:"project_id"`
	Role      string `json:"role"`
	// ExpiresInDays is a DURATION, not a timestamp: 0 means never, and only
	// 7/30/90 are accepted. A client-supplied absolute date would be
	// clock-skew dependent and forgeable into the far future.
	ExpiresInDays int `json:"expires_in_days"`
	// EmbedDomains is a space-separated list of origins allowed to frame this
	// link (see parseEmbedDomains). Empty — the default — means the link is
	// not embeddable at all.
	EmbedDomains string `json:"embed_domains"`
	// EmbedLive opts an embed into realtime. Off by default: a framed board
	// otherwise holds a socket open per viewer on someone else's page.
	EmbedLive bool `json:"embed_live"`
}

// updateShareLinkRequest changes the embed policy on a link that already
// exists.
//
// EMBED SETTINGS ONLY, and the omissions are the design. Role and expiry stay
// immutable: everyone already holding the URL would silently inherit a changed
// role, and a revoke-and-remint makes that widening visible by invalidating the
// old token. Editing where a board may be FRAMED does not re-grant anything to
// an existing holder — the link already opens for them — so it is the one part
// of a live link that can change in place without surprising someone.
//
// Both fields are required rather than optional-with-omission. A PATCH whose
// absent field means "leave alone" cannot express "clear the domains", which is
// precisely the edit an owner reaching for this needs most.
type updateShareLinkRequest struct {
	EmbedDomains string `json:"embed_domains"`
	EmbedLive    bool   `json:"embed_live"`
}

type shareLinkResponse struct {
	ID        string `json:"id"`
	Token     string `json:"token"`
	Role      string `json:"role"`
	ExpiresAt string `json:"expires_at"`
	IsActive  bool   `json:"is_active"`
	Created   string `json:"created"`
	// Both are OWNER-facing only. This struct is returned by mint, list,
	// update and revoke, every one of which is behind requireAuth +
	// isProjectOwner. The public metadata endpoint builds its own body and
	// deliberately omits EmbedDomains — see handleShareLinkMetadata.
	EmbedDomains string `json:"embed_domains"`
	EmbedLive    bool   `json:"embed_live"`
}

type shareLinkListResponse struct {
	Links []shareLinkResponse `json:"links"`
}

type shareLinkErrorResponse struct {
	Error string `json:"error"`
}

func toShareLinkResponse(r *core.Record) shareLinkResponse {
	return shareLinkResponse{
		ID:        r.Id,
		Token:     r.GetString("token"),
		Role:      r.GetString("role"),
		ExpiresAt: r.GetString("expires_at"),
		IsActive:  r.GetBool("is_active"),
		Created:   r.GetString("created"),

		EmbedDomains: r.GetString("embed_domains"),
		EmbedLive:    r.GetBool("embed_live"),
	}
}

// handleCreateShareLink mints a link for a board the caller owns.
func handleCreateShareLink(app core.App, re *core.RequestEvent) error {
	if !shareLinkLimiter.Allow(ratelimit.ClientIP(re.Request)) {
		return re.JSON(http.StatusTooManyRequests,
			shareLinkErrorResponse{Error: "rate limit exceeded"})
	}

	var body createShareLinkRequest
	if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil {
		return re.BadRequestError("invalid request body", nil)
	}
	if body.ProjectID == "" {
		return re.BadRequestError("project_id is required", nil)
	}
	if !validShareRole(body.Role) {
		return re.BadRequestError("role must be viewer, commentor or editor", nil)
	}
	expiresAt, err := resolveExpiry(body.ExpiresInDays)
	if err != nil {
		return re.BadRequestError(err.Error(), nil)
	}
	// Validated HERE, at the point the value is stored, rather than where it is
	// written into a header: CSP has no escaping, so a malformed origin cannot
	// be made safe downstream, and this is the only place the error can reach
	// the person who typed it.
	embedDomains, err := parseEmbedDomains(body.EmbedDomains)
	if err != nil {
		return re.BadRequestError(err.Error(), nil)
	}

	if !isProjectOwner(app, body.ProjectID, re.Auth.Id) {
		// 403, not 404: the caller is authenticated and the board may well be
		// one they can read — what they cannot do is widen access to it.
		return re.ForbiddenError("only an owner can create a share link", nil)
	}

	token, err := newShareToken()
	if err != nil {
		return re.InternalServerError("failed to generate token", err)
	}

	col, err := app.FindCollectionByNameOrId("boards_share_links")
	if err != nil {
		return re.InternalServerError("share links unavailable", err)
	}
	link := core.NewRecord(col)
	link.Set("project", body.ProjectID)
	link.Set("token", token)
	link.Set("role", body.Role)
	link.Set("created_by", re.Auth.Id)
	link.Set("is_active", true)
	link.Set("expires_at", expiresAt)
	link.Set("embed_domains", embedDomains)
	// Liveness is meaningless on a link nobody may frame, and storing it anyway
	// would leave a stale true behind if the domains were later cleared.
	link.Set("embed_live", embedDomains != "" && body.EmbedLive)
	if err := app.Save(link); err != nil {
		return re.InternalServerError("failed to create share link", err)
	}

	syncProjectVisibility(app, body.ProjectID)

	return re.JSON(http.StatusOK, toShareLinkResponse(link))
}

// handleListShareLinks returns every link on a board the caller owns.
//
// The rules would already scope boards_share_links to owners, so a client could
// read this through ordinary REST. It exists so the dialog has one shape to
// render and so listing stays symmetric with mint and revoke.
func handleListShareLinks(app core.App, re *core.RequestEvent) error {
	if !shareLinkLimiter.Allow(ratelimit.ClientIP(re.Request)) {
		return re.JSON(http.StatusTooManyRequests,
			shareLinkErrorResponse{Error: "rate limit exceeded"})
	}

	projectID := re.Request.URL.Query().Get("project_id")
	if projectID == "" {
		return re.BadRequestError("project_id is required", nil)
	}
	if !isProjectOwner(app, projectID, re.Auth.Id) {
		return re.ForbiddenError("only an owner can read a board's share links", nil)
	}

	records, err := app.FindRecordsByFilter(
		"boards_share_links", "project = {:p}", "-created", 0, 0,
		dbx.Params{"p": projectID},
	)
	if err != nil {
		return re.InternalServerError("failed to load share links", err)
	}

	links := make([]shareLinkResponse, 0, len(records))
	for _, r := range records {
		links = append(links, toShareLinkResponse(r))
	}
	return re.JSON(http.StatusOK, shareLinkListResponse{Links: links})
}

// handleUpdateShareLink changes which origins may frame an existing link.
//
// This exists because the embed policy is the one share-link setting whose
// right value is not knowable when the link is minted: an owner pastes the
// snippet, discovers the origin they named was wrong, and — before this — had
// no way to correct it. Revoking and re-minting would have worked, but it
// changes the token, so every page already carrying the old snippet breaks to
// fix a typo.
//
// The token, role and expiry are untouched; see updateShareLinkRequest.
//
// A REVOKED OR EXPIRED LINK IS STILL EDITABLE, deliberately. embed_domains has
// no effect on a dead link — embedDomainsFor resolves through resolveLiveLink,
// so framing stops when the link stops — and refusing the edit would mean an
// owner cannot tidy a policy on a link they might later want to reason about.
// What must never happen is the reverse: editing must not resurrect a link, and
// it does not, because nothing here writes is_active or expires_at.
func handleUpdateShareLink(app core.App, re *core.RequestEvent) error {
	if !shareLinkLimiter.Allow(ratelimit.ClientIP(re.Request)) {
		return re.JSON(http.StatusTooManyRequests,
			shareLinkErrorResponse{Error: "rate limit exceeded"})
	}

	id := re.Request.PathValue("id")
	if id == "" {
		return re.BadRequestError("share link id is required", nil)
	}

	var body updateShareLinkRequest
	if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil {
		return re.BadRequestError("invalid request body", nil)
	}
	// Validated before the record is loaded, matching mint: the same parser,
	// so an origin that is refused at mint is refused here in the same words.
	embedDomains, err := parseEmbedDomains(body.EmbedDomains)
	if err != nil {
		return re.BadRequestError(err.Error(), nil)
	}

	link, err := app.FindRecordById("boards_share_links", id)
	if err != nil || link == nil {
		return re.NotFoundError("share link not found", nil)
	}
	if !isProjectOwner(app, link.GetString("project"), re.Auth.Id) {
		// 404 rather than 403, matching revoke: to a non-owner this link must
		// not be distinguishable from one that does not exist.
		return re.NotFoundError("share link not found", nil)
	}

	link.Set("embed_domains", embedDomains)
	// Same invariant mint enforces: liveness is meaningless on a link nobody
	// may frame, and storing it would leave a stale true behind. Clearing the
	// domains here is exactly the path that would otherwise strand one.
	link.Set("embed_live", embedDomains != "" && body.EmbedLive)
	if err := app.Save(link); err != nil {
		return re.InternalServerError("failed to update share link", err)
	}

	// No syncProjectVisibility call: the badge tracks whether a live link
	// exists, and this endpoint cannot change that.

	return re.JSON(http.StatusOK, toShareLinkResponse(link))
}

// handleRevokeShareLink deactivates a link.
//
// A soft flip, matching drive: the row and its token survive, so revoking is
// reversible and an audit of who minted what stays intact. Revocation is
// immediate regardless — the rule re-reads is_active on every request, with no
// session or cache in between.
//
// Note what revoking does NOT do: someone who already redeemed the link holds a
// real boards_project_members row and keeps their access. The dialog and the
// help topic both say so, because "revoke" plainly means two different things
// before and after a sign-in.
func handleRevokeShareLink(app core.App, re *core.RequestEvent) error {
	if !shareLinkLimiter.Allow(ratelimit.ClientIP(re.Request)) {
		return re.JSON(http.StatusTooManyRequests,
			shareLinkErrorResponse{Error: "rate limit exceeded"})
	}

	id := re.Request.PathValue("id")
	if id == "" {
		return re.BadRequestError("share link id is required", nil)
	}

	link, err := app.FindRecordById("boards_share_links", id)
	if err != nil || link == nil {
		return re.NotFoundError("share link not found", nil)
	}
	if !isProjectOwner(app, link.GetString("project"), re.Auth.Id) {
		// 404 rather than 403: to a non-owner this link should not be
		// distinguishable from one that does not exist.
		return re.NotFoundError("share link not found", nil)
	}

	link.Set("is_active", false)
	if err := app.Save(link); err != nil {
		return re.InternalServerError("failed to revoke share link", err)
	}

	syncProjectVisibility(app, link.GetString("project"))

	return re.JSON(http.StatusOK, toShareLinkResponse(link))
}

// syncProjectVisibility keeps boards_projects.visibility in step with whether
// the board has at least one live link.
//
// DISPLAY ONLY. The rules deliberately do not consult it — authority is the
// link row itself, and two sources of truth could disagree (a live link on a
// board marked private: which wins?). It exists so the board list can show a
// "shared" badge without querying boards_share_links, which non-owners cannot
// read. Because it is decorative, a desync is cosmetic rather than a hole; if
// it is ever put in a rule it must be an AND, never an OR.
//
// Deliberately not swept on expiry: that would need a cron, and a board whose
// only link lapsed yesterday showing a stale badge is a cosmetic wrong.
//
// A failure here never fails the mint or revoke that triggered it — the badge
// is not worth losing a link over — but it is LOGGED rather than discarded. A
// systematic desync (a renamed field, a rule change that starts refusing the
// save) would otherwise be invisible, and "the badge is wrong on every board"
// is a bug someone should be able to find without reading this function.
func syncProjectVisibility(app core.App, projectID string) {
	if projectID == "" {
		return
	}
	n, err := app.CountRecords("boards_share_links",
		dbx.HashExp{"project": projectID, "is_active": true})
	if err != nil {
		app.Logger().Warn("cards: counting share links for the visibility badge",
			"project", projectID, "error", err)
		return
	}
	project, err := app.FindRecordById("boards_projects", projectID)
	if err != nil || project == nil {
		app.Logger().Warn("cards: loading the board for the visibility badge",
			"project", projectID, "error", err)
		return
	}
	want := "private"
	if n > 0 {
		want = "link"
	}
	if project.GetString("visibility") == want {
		return
	}
	project.Set("visibility", want)
	if err := app.Save(project); err != nil {
		app.Logger().Warn("cards: saving the visibility badge",
			"project", projectID, "visibility", want, "error", err)
	}
}
