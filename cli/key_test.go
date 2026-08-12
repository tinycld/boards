package cli

import "testing"

// The hand-kept twin of tests/card-key.test.ts.
//
// rank_test.go can check itself against captured vectors shared with the npm
// package; there is no such fixture for keys, so these cases ARE the contract.
// A case added on either side needs the same case added on the other, or the
// CLI and the app will disagree about what OTTER-123 means.

func TestFormatCardKey(t *testing.T) {
	cases := []struct {
		name   string
		slug   string
		number int
		want   string
	}{
		{"joins a slug and a number", "OTTER", 123, "OTTER-123"},
		// The card exists locally before the server numbers it.
		{"unassigned number", "OTTER", 0, ""},
		// A board created without a slug — the column is optional.
		{"board with no slug", "", 12, ""},
		{"negative number", "OTTER", -3, ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := formatCardKey(tc.slug, tc.number); got != tc.want {
				t.Errorf("formatCardKey(%q, %d) = %q, want %q", tc.slug, tc.number, got, tc.want)
			}
		})
	}
}

func TestParseCardKey(t *testing.T) {
	cases := []struct {
		name       string
		input      string
		wantSlug   string
		wantNumber int
		wantOK     bool
	}{
		{"parses a key", "OTTER-123", "OTTER", 123, true},
		// A key pasted from chat or typed into a shell arrives in any case.
		{"uppercases the slug", "otter-123", "OTTER", 123, true},
		{"tolerates whitespace", "  OTTER-7  ", "OTTER", 7, true},
		// How getCard tells a key from an id without pre-checking.
		{"raw record id", "r8f3k2m9x1p7q4w", "", 0, false},
		{"leading zeros", "OTTER-007", "", 0, false},
		{"zero", "OTTER-0", "", 0, false},
		{"negative", "OTTER--3", "", 0, false},
		{"oversize slug", "AAAAAAAAAAA-1", "", 0, false},
		{"space in slug", "OT TER-1", "", 0, false},
		{"underscore in slug", "OT_TER-1", "", 0, false},
		{"no number", "OTTER-", "", 0, false},
		{"empty", "", "", 0, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			slug, number, ok := parseCardKey(tc.input)
			if ok != tc.wantOK || slug != tc.wantSlug || number != tc.wantNumber {
				t.Errorf("parseCardKey(%q) = (%q, %d, %v), want (%q, %d, %v)",
					tc.input, slug, number, ok, tc.wantSlug, tc.wantNumber, tc.wantOK)
			}
		})
	}
}

// What the app formats, the CLI must parse. This is the round trip that keeps a
// key copied off a card face working as a CLI argument.
func TestCardKeyRoundTrip(t *testing.T) {
	slug, number, ok := parseCardKey(formatCardKey("OTTER", 42))
	if !ok || slug != "OTTER" || number != 42 {
		t.Fatalf("round trip = (%q, %d, %v), want (OTTER, 42, true)", slug, number, ok)
	}
}
