package cli

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Card keys — the Go half of tinycld/boards/lib/card-key.ts.
//
// Two implementations of one grammar, which is the same bargain rank.go makes
// with lib/rank.ts, and it is worth taking here for the same reason: a CLI
// cannot import a TypeScript module, and the alternative — a server endpoint
// that parses keys — would put a network round trip in front of an argument the
// caller already typed.
//
// Unlike ranks there is NO captured-vector fixture holding the two in step, so
// key_test.go's table and card-key.test.ts's table are the only thing that
// does. Change one, change the other.
const maxSlugLength = 10

var cardKeyPattern = regexp.MustCompile(`^([A-Za-z0-9]+)-([1-9][0-9]*)$`)

// formatCardKey renders OTTER-123, or "" when either half is missing — a board
// with no slug, or a card the server has not numbered.
func formatCardKey(slug string, number int) string {
	if slug == "" || number <= 0 {
		return ""
	}
	return fmt.Sprintf("%s-%d", slug, number)
}

// parseCardKey splits a key, uppercasing the slug so one typed in lower case
// still resolves. ok=false for anything that is not a key — which is how a
// caller distinguishes a key from a raw 15-character record id without
// pre-checking: an id has no hyphen and simply does not match.
//
// Leading zeros are rejected for the same reason the TS twin rejects them:
// OTTER-007 is a typo, and accepting it would give one card two spellings.
func parseCardKey(input string) (slug string, number int, ok bool) {
	m := cardKeyPattern.FindStringSubmatch(strings.TrimSpace(input))
	if m == nil {
		return "", 0, false
	}
	if len(m[1]) > maxSlugLength {
		return "", 0, false
	}
	n, err := strconv.Atoi(m[2])
	if err != nil {
		return "", 0, false
	}
	return strings.ToUpper(m[1]), n, true
}
