package boards

import (
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/embedpolicy"
)

// Which pages of ours may be framed, and by whom.
//
// Core sets `frame-ancestors` on every HTML response and defaults it to 'none'
// (coreserver's writeAppShell). It cannot know that /p/boards/<token> is
// framable, because the answer lives on a boards_share_links row behind boards'
// own owner-only rules — so boards registers this resolver and core asks it.
// The slug lives here; core names no package.
//
// The URL this claims is the PUBLIC share route with an explicit opt-in:
//
//	/p/boards/<token>?embed=1
//
// The query parameter is load-bearing rather than cosmetic. Without it the
// same token still opens the ordinary share page, which must stay unframable —
// so a link that someone embedded cannot also be silently framed in its
// full-chrome form, and the read-only board a visitor sees at a bare share URL
// is never a clickjacking surface.

// embedRoutePrefix is the public share route boards owns.
const embedRoutePrefix = "/p/boards/"

// registerEmbedPolicy teaches core which origins may frame a shared board.
func registerEmbedPolicy(app core.App) {
	embedpolicy.Register(func(r *http.Request) []string {
		token := embedTokenFromRequest(r)
		if token == "" {
			return nil
		}
		return embedDomainsFor(app, token)
	})
}

// embedTokenFromRequest returns the share token an embed request names, or ""
// when the request is not an embed of a board.
//
// Separated from the lookup so the URL grammar is testable without a database,
// and kept strict on purpose: this decides whether a page gets a framing grant
// at all, so anything it does not recognise exactly must fall through to the
// caller's 'none'.
func embedTokenFromRequest(r *http.Request) string {
	if r == nil || r.URL == nil {
		return ""
	}
	if !strings.HasPrefix(r.URL.Path, embedRoutePrefix) {
		return ""
	}
	// Opt-in only. The bare share page stays unframable — see the header.
	if r.URL.Query().Get("embed") != "1" {
		return ""
	}
	token := strings.TrimPrefix(r.URL.Path, embedRoutePrefix)
	// One segment exactly. A deeper path is not a share URL, and trimming to
	// the first segment would let /p/boards/<token>/anything inherit the grant.
	if token == "" || strings.Contains(token, "/") {
		return ""
	}
	return token
}
