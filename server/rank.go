package boards

import (
	"fmt"

	"roci.dev/fracdex"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Fractional ranks, server side.
//
// This is the THIRD implementation of the same key space — the app uses npm
// `fractional-indexing` (tinycld/boards/lib/rank.ts), the CLI uses
// `roci.dev/fracdex` (cli/rank.go), and this uses that same Go port. The
// library choice is not incidental: a rank is computed by whoever inserts the
// row, and now three callers insert cards. If any two disagreed, a card
// created here would sort somewhere the app would not have put it, with no
// error raised anywhere.
//
// fracdex is therefore the first external dependency in this module, whose
// go.mod otherwise documents having none. It needs no go.sum: the hash lands
// in the gitignored go.work.sum, which `go mod download` regenerates — the
// same treatment every other dependency here gets.
//
// The two properties cli/rank.go warns about hold verbatim:
//
//  1. RANKS ARE NOT UNIQUE. Two writers splitting the same gap compute the
//     same string, and there is no unique index on `position`. Every query
//     ordering by rank MUST sort `position, id`.
//  2. THE KEY SPACE IS ASCII-ORDERED and lengths vary. Never parse a rank,
//     compare it numerically, or assume a width.

// rankAppendToList returns the rank placing a card after every card already in
// `listID`.
//
// Reads the maximum position directly rather than loading the list's cards:
// appending needs one string, and a board column can hold thousands of rows.
// The ordering is the string ordering the key space defines, which is what
// SQLite's default (BINARY) collation on a text column already is — the same
// comparison `ORDER BY position, id` makes everywhere else.
//
// An empty list (no rows, or a NULL max) yields the first rank, exactly as
// rankForAppend's empty-slice case does.
// rankAfter is the rank placing a row after `last` (the first rank when
// `last` is empty) — what a new sprint takes to land after the planned ones.
func rankAfter(last string) (string, error) {
	return fracdex.KeyBetween(last, "")
}

// ranksAppending returns n ascending ranks that all sort after `last` (or from
// the start of the key space when it is empty).
//
// The Go counterpart of lib/rank.ts's `ranksAfter`, and needed for the same
// reason the bulk actions needed that one: rankAfter called n times against
// unchanged state returns the SAME string every time, so an importer laying
// down a column of cards would put every one of them on one rank and lose the
// order to the id tiebreaker.
//
// fracdex.NKeysBetween is the direct port of the npm package's
// generateNKeysBetween, which is what makes the two byte-compatible — the
// property this file's header calls structural. testdata/nkeys_vectors.json
// holds keys captured FROM the npm package, so a divergence fails here rather
// than showing up as cards sorting differently in the app than in an import.
func ranksAppending(last string, n int) ([]string, error) {
	if n < 0 {
		return nil, fmt.Errorf("boards: rank count must not be negative (got %d)", n)
	}
	return fracdex.NKeysBetween(last, "", uint(n))
}

func rankAppendToList(app core.App, listID string) (string, error) {
	var last string
	err := app.DB().
		NewQuery("SELECT COALESCE(MAX(position), '') AS p FROM boards_cards WHERE list = {:list}").
		Bind(dbx.Params{"list": listID}).
		Row(&last)
	if err != nil {
		return "", err
	}
	return fracdex.KeyBetween(last, "")
}
