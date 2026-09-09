package boards

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
	"tinycld.org/core/ratelimit"
)

// Share-link primitives for M6a.
//
// A link grants READ of one board to an unauthenticated visitor. The rule does
// the authorizing — pb-migrations/1980000003 adds a token disjunct to list/view
// on every board collection — so nothing here checks access on a read path.
// What Go owns is the part a rule cannot: 32 bytes of entropy, and the
// owner-only gate on minting a credential that widens access.

// Link roles. Deliberately NOT reusing core's sharelink.Claims helpers, whose
// CanComment admits `viewer` by drive's product decision. Boards' shipped
// viaCommenter names owner|editor|commentor and excludes viewer BY OMISSION —
// the same discipline lib/permissions.ts documents — so the two vocabularies
// are genuinely different and unifying them would silently widen one.
const (
	shareRoleViewer    = "viewer"
	shareRoleCommentor = "commentor"
	shareRoleEditor    = "editor"
)

// validShareRole reports whether a role may be minted onto a link.
//
// `owner` is absent from boards_share_links.role's enum on purpose: a link must
// never confer ownership of a board. Rejected explicitly rather than coerced to
// viewer — drive silently downgrades an unknown role, which is how a UI bug
// ships as "the link works, just not the way you asked".
func validShareRole(role string) bool {
	switch role {
	case shareRoleViewer, shareRoleCommentor, shareRoleEditor:
		return true
	}
	return false
}

// allowedExpiryDays is the set a caller may choose from. A closed set, not a
// range: the UI offers exactly these, and an arbitrary number reaching the
// column is either a client bug or someone probing.
var allowedExpiryDays = map[int]bool{7: true, 30: true, 90: true}

// defaultExpiryDays is what the UI preselects. Drive mints links that never
// expire; a board is a bigger surface than a file, so cards defaults short and
// makes "never" an explicit choice.
const defaultExpiryDays = 7

// resolveExpiry turns a duration in days into the value the column stores.
//
// A DURATION, not a timestamp the client supplies: an absolute date is
// clock-skew dependent and lets a caller backdate a link or mint one good for a
// century. `days == 0` means never, which stores "" — the empty-string branch
// the rule's `expires_at ?= ""` matches.
func resolveExpiry(days int) (string, error) {
	if days == 0 {
		return "", nil
	}
	if !allowedExpiryDays[days] {
		return "", fmt.Errorf("expires_in_days must be 0 (never), 7, 30 or 90")
	}
	return types.NowDateTime().Add(time.Duration(days) * 24 * time.Hour).String(), nil
}

// newShareToken returns 32 bytes of entropy as 64 hex chars, matching the
// column's min/max. Server-side because a client-chosen token is a client-
// chosen credential.
func newShareToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// isProjectOwner mirrors the migration's viaOwner fragment.
//
// Restated in Go because these endpoints bypass the collection rules
// (FindFirstRecordByFilter and Save do not evaluate them), and minting a link
// WIDENS access — an editor must not be able to do it. Kept as one query
// against the same table the rule reads, so the two cannot drift in shape even
// though they are written twice.
func isProjectOwner(app core.App, projectID, userID string) bool {
	if projectID == "" || userID == "" {
		return false
	}
	n, err := app.CountRecords("boards_project_members",
		dbx.HashExp{"project": projectID, "user": userID, "role": "owner"})
	return err == nil && n > 0
}

// shareLinkLimiter bounds minting and listing per IP. The public read path is
// not limited here — it is the collection rules, i.e. ordinary REST, and
// limiting it would mean limiting every authenticated board read too.
var shareLinkLimiter = ratelimit.New(60, time.Minute)

// otpLimiter is deliberately far stricter, and the arithmetic is why: an OTP is
// six digits, a ~10^6 keyspace. At 60/min a single IP gets roughly 900 guesses
// inside one 15-minute TTL, which is uncomfortably close to meaningful. 10/min
// gives ~150 — still generous for a person who mistypes a couple of times, and
// materially tighter for a script.
//
// It is one layer, not the defence. Single-use deletion on success and the TTL
// are what make the code safe; this bounds how fast someone can attack it from
// one host, and in-memory state does not hold across instances.
var otpLimiter = ratelimit.New(10, time.Minute)

// maxEmbedDomains bounds how many origins one link may name. A closed bound,
// like allowedExpiryDays: a board is framed on a handful of pages, and an
// unbounded list would be written straight into a response header.
const maxEmbedDomains = 10

// parseEmbedDomains normalizes the origins a link may be framed at.
//
// Returns the canonical, space-separated form to store. An empty result means
// NOT EMBEDDABLE, which is the default and the safe direction.
//
// What counts as an origin here is deliberately narrow — scheme + host +
// optional port, nothing else — because the value's only destination is a
// `frame-ancestors` directive, and CSP gives no quoting: a stray space, semi-
// colon or newline in a stored value does not corrupt one origin, it changes
// which directives the browser sees. Rejecting explicitly rather than
// sanitizing is the same discipline validShareRole applies to roles; a value
// that survives this function is safe to concatenate.
//
// No wildcards in this first cut. `*.example.com` is a meaningful and common
// ask, but it is also the form that turns one compromised subdomain into a
// framing grant, so it is a decision to take deliberately rather than inherit
// from a permissive parser.
func parseEmbedDomains(raw string) (string, error) {
	fields := strings.Fields(raw)
	if len(fields) == 0 {
		return "", nil
	}
	if len(fields) > maxEmbedDomains {
		return "", fmt.Errorf("at most %d embed domains", maxEmbedDomains)
	}

	out := make([]string, 0, len(fields))
	seen := make(map[string]bool, len(fields))
	for _, field := range fields {
		origin, err := parseEmbedOrigin(field)
		if err != nil {
			return "", err
		}
		if seen[origin] {
			continue
		}
		seen[origin] = true
		out = append(out, origin)
	}
	return strings.Join(out, " "), nil
}

// parseEmbedOrigin validates one origin and returns its canonical form.
func parseEmbedOrigin(raw string) (string, error) {
	// A bare host is the mistake everyone makes, and it is ambiguous rather
	// than wrong: `example.com` in frame-ancestors matches BOTH schemes. Say
	// so instead of guessing which one the owner meant.
	if !strings.Contains(raw, "://") {
		return "", fmt.Errorf("%q must include a scheme, e.g. https://%s", raw, raw)
	}

	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("%q is not a valid origin", raw)
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return "", fmt.Errorf("%q must use http or https", raw)
	}
	if u.Host == "" {
		return "", fmt.Errorf("%q is missing a host", raw)
	}
	// Anything past the origin is silently ignored by the browser, so storing
	// it would leave an owner believing they had scoped a grant to one page.
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" ||
		u.User != nil {
		return "", fmt.Errorf("%q must be an origin only, with no path or credentials", raw)
	}
	if strings.ContainsAny(u.Host, "*") {
		return "", fmt.Errorf("%q may not use a wildcard", raw)
	}
	// Belt and braces over the checks above: these are the characters that
	// would let a stored value forge a second CSP directive.
	if strings.ContainsAny(raw, " \t\r\n;,'\"") {
		return "", fmt.Errorf("%q contains an unsupported character", raw)
	}

	return u.Scheme + "://" + u.Host, nil
}

// embedDomainsFor returns the origins that may frame the link this token names,
// or nil when the token is unknown, dead, or not embeddable.
//
// Reads through resolveLiveLink so revocation and expiry govern framing exactly
// as they govern reading — a revoked link must stop being embeddable at the
// same instant it stops being readable, and sharing the resolver is what stops
// those two from drifting.
func embedDomainsFor(app core.App, token string) []string {
	link, _, _, _ := resolveLiveLink(app, token)
	if link == nil {
		return nil
	}
	domains := strings.Fields(link.GetString("embed_domains"))
	if len(domains) == 0 {
		return nil
	}
	return domains
}
