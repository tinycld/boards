package boards

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/sharequota"
)

// meterAttachmentDownload charges one attachment fetch against the share
// link's download ceilings.
//
// Boards has no endpoint to put this in. A visitor holding a link reads the
// board through ordinary PocketBase REST — the share-token disjunct in
// 1980000003 lets their token satisfy the same rules a member's session does
// — and an attachment's bytes come from PocketBase's own file route. So the
// meter runs on that route's hook, which fires after the collection's view
// rule has already admitted the caller and before a byte is served.
//
// # This meters, it never authorizes
//
// The access decision was made before this ran. Every path where the link
// cannot be identified serves the file: no token, a dead token, a token for
// another board. That is deliberate and it is not a hole — a caller who got
// here without a usable token was admitted by the OTHER half of the rule, as
// a member reading their own board, and a member's read is not a share-link
// download.
//
// # Why the token is re-checked in Go
//
// X-Share-Token is client-supplied and, from here, unvalidated. The rule did
// validate it — but as one of two disjuncts, and this hook cannot tell which
// one fired. So a member fetching an attachment they are entitled to could
// attach any token they liked, and a meter that trusted the header would let
// them drain a stranger's link using their own legitimate reads. Re-resolving
// through resolveLiveLink, and then binding the link to the record being
// served, is what closes that.
//
// The project check is the easy line to leave out and it is the whole
// isolation: without it a token for board A charges a fetch from board B. It
// restates the rule's own `project ?= ...` clause in Go, for the same reason
// isProjectOwner does.
func meterAttachmentDownload(app core.App, e *core.FileDownloadRequestEvent) error {
	token := e.Request.Header.Get("X-Share-Token")
	if token == "" {
		return e.Next()
	}

	link, _, _, _ := resolveLiveLink(app, token)
	if link == nil {
		return e.Next()
	}
	if link.GetString("project") != e.Record.GetString("project") {
		return e.Next()
	}

	// A thumbnail is not the attachment. A board renders every card's
	// thumbnail when it loads, so charging them would drain a link on one
	// page view — the same reason drive does not meter its thumbnail
	// endpoint.
	if e.Request.URL.Query().Get("thumb") != "" {
		return e.Next()
	}

	// HEAD serves no body, and charging it would let a `curl -I` loop drain
	// a link with nothing leaving.
	if e.Request.Method == http.MethodHead {
		return e.Next()
	}

	if !isChargeableRange(e.Request) {
		return e.Next()
	}

	allowed, err := claimShareLinkDownload(app, token, sharequota.Limits(app))
	switch {
	case err != nil:
		// Fail OPEN, matching drive. A commercial ceiling is not an access
		// check, and a transient database error must not look to a visitor
		// like the board was unshared.
		shareLog.Warn("could not claim board attachment download", "token", token, "err", err)
	case !allowed:
		return refuseAttachmentDownload(app, e, token)
	}

	return e.Next()
}

// isChargeableRange reports whether this request counts as a download.
//
// PocketBase serves files through http.ServeContent, which honours Range — so
// one video scrub is dozens of requests through this hook for one logical
// download, while drive's handler ignores Range entirely and counts one per
// request. Left alone, the same ceiling would mean "20 downloads" on drive and
// "one seek" here.
//
// So only a request that is not a mid-file continuation is charged: no Range
// header, or one starting at byte zero. The unit becomes "one transfer a
// client started", which is the closest honest match to drive's "one handler
// invocation" — a player seeking within a file pays once for opening it, and
// a download resuming at byte N is not charged a second time for the same
// file.
//
// Deliberately not exact, and both inaccuracies forgive the visitor: a client
// re-opening from byte zero pays each time, which is correct because those are
// real transfers, and a client fetching in chunks after one at zero pays once,
// which undercounts by at most one file.
func isChargeableRange(r *http.Request) bool {
	v := r.Header.Get("Range")
	if v == "" {
		return true
	}
	return strings.HasPrefix(v, "bytes=0-")
}

// refuseAttachmentDownload turns a refusal into a response.
//
// Same two statuses as drive, for the same reasons: a lifetime refusal is
// terminal so 410, a daily one resolves at midnight so 429 with Retry-After.
func refuseAttachmentDownload(app core.App, e *core.FileDownloadRequestEvent, token string) error {
	limits := sharequota.Limits(app)
	lifetime, day, err := shareLinkDownloadCounts(app, token)
	if err != nil {
		shareLog.Warn("could not read board link counters after a refusal", "token", token, "err", err)
		return e.TooManyRequestsError("this board's share link has reached its download limit", nil)
	}

	if limits.Lifetime > 0 && lifetime >= limits.Lifetime {
		shareLog.Warn("board link refused at its lifetime download ceiling",
			"token", token, "downloads", lifetime, "ceiling", limits.Lifetime)
		return e.Error(http.StatusGone, "this board's share link has reached its download limit", nil)
	}

	shareLog.Warn("board link refused at its daily download ceiling",
		"token", token, "downloadsToday", day, "ceiling", limits.PerDay)
	e.Response.Header().Set("Retry-After", strconv.Itoa(secondsUntilUTCMidnight(time.Now().UTC())))
	return e.TooManyRequestsError("this board's share link has hit today's download limit; it resets at midnight UTC", nil)
}
