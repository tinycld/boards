package boards

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
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
