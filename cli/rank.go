package cli

import (
	"roci.dev/fracdex"
)

// Fractional ranks for ordering lists and cards.
//
// This is the Go half of what `tinycld/cards/lib/rank.ts` does on the client,
// and it is the SAME LIBRARY: the app uses npm `fractional-indexing`
// (rocicorp/fractional-indexing) and this uses `roci.dev/fracdex`, the same
// authors' Go port, which is byte-for-byte compatible with it. Both implement
// David Greenspan's "Implementing Fractional Indexing".
//
// That compatibility is load-bearing rather than incidental — a rank is
// computed by whoever inserts the row, and both the app and the CLI insert
// rows. If the two ever disagreed, a card created here would sort somewhere
// the app would not have put it, with no error raised anywhere. So
// rank_test.go re-checks the claim against vectors captured from the npm
// package rather than taking the README's word for it.
//
// This file is deliberately only a thin naming layer over fracdex, mirroring
// what lib/rank.ts is over the npm package: it names the operations in cards'
// terms and keeps the choice of implementation in one place.
//
// TWO PROPERTIES CALLERS MUST KNOW, both inherited from the TS side:
//
//  1. RANKS ARE NOT UNIQUE. Two clients splitting the same gap compute the same
//     string, and there is deliberately no unique index on `position`. Every
//     query ordering by rank MUST sort `position, id` — `id` is the tiebreaker
//     that keeps a tie rendering identically everywhere.
//  2. THE KEY SPACE IS ASCII-ORDERED across 0-9, A-Z, a-z, and lengths vary.
//     Never parse a rank, compare it numerically, or assume a width. Compare
//     ranks only as strings.

// rankBetween returns a rank sorting strictly between a and b. "" means
// unbounded on that side, so rankBetween("", "") is the first rank.
//
// fracdex refuses a reversed or equal pair (`a >= b`) rather than returning a
// plausible key, which is the behaviour lib/rank.ts adds its own guard to
// preserve — npm 4.0.0 silently SWAPS reversed arguments, and a card would
// land in the wrong place with no error. Pinned by a test.
func rankBetween(a, b string) (string, error) {
	return fracdex.KeyBetween(a, b)
}

// rankForAppend returns the rank placing a row after every rank in `positions`,
// which must already be sorted. An empty slice yields the first rank.
func rankForAppend(positions []string) (string, error) {
	if len(positions) == 0 {
		return rankBetween("", "")
	}
	return rankBetween(positions[len(positions)-1], "")
}

// rankForPrepend returns the rank placing a row before every rank in
// `positions`, which must already be sorted.
func rankForPrepend(positions []string) (string, error) {
	if len(positions) == 0 {
		return rankBetween("", "")
	}
	return rankBetween("", positions[0])
}

// rankForInsert returns the rank landing a row at `index` in the FINAL
// ordering, so 0 prepends and len(positions) appends. Out-of-range indexes
// clamp rather than fail.
//
// Ranks are not unique, and KeyBetween refuses neighbours that do not sort
// strictly apart — so when the gap at `index` is a TIED RUN this widens the
// window backwards past the duplicates instead of failing. The row lands
// within the tied run rather than at a mathematically exact index, which is
// the correct trade: a tied run has no agreed order to be exact about, and the
// alternative is an error on an ordinary insert. lib/move.ts widens the same
// way for the same reason.
func rankForInsert(positions []string, index int) (string, error) {
	if index <= 0 {
		return rankForPrepend(positions)
	}
	if index >= len(positions) {
		return rankForAppend(positions)
	}
	after := positions[index]
	before := ""
	for i := index - 1; i >= 0; i-- {
		if positions[i] < after {
			before = positions[i]
			break
		}
	}
	return rankBetween(before, after)
}
