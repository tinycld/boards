package boards

import (
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
