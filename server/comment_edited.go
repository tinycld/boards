package boards

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// registerCommentEditedAt owns boards_comments.edited_at — the timestamp the
// "(edited)" marker renders from.
//
// The marker used to be inferred from `updated != created`, and that inference
// is broken at the source: both are millisecond-precision autodates, so a
// create and an edit reaching the server inside the same millisecond leave the
// strings byte-identical and the comment reads as never-edited, permanently. A
// human cannot edit that fast; a client whose optimistic create and first edit
// arrive back-to-back can, and does (the cards e2e suite caught it live).
//
// The column is SERVER-OWNED in fact, not by convention, the same way
// card_number.go owns `number`: no access rule pins a scalar field, so a
// client could otherwise revise a body while withholding the marker — or stamp
// a marker onto an untouched comment. Both directions are decided here from
// the stored row:
//
//   - body changed  → edited_at = now, overwriting whatever the request said.
//   - body unchanged → edited_at is restored from the stored row, so a
//     client-supplied value cannot invent an edit that never happened.
//
// The blank-Original guard mirrors card_number.go's: Save() does not refresh
// originalData in place, so a caller re-saving a record it already held
// arrives here with an empty Original. `body` is required (min 1), so a blank
// prior can only mean "unknown", never "was empty" — and with no stored row to
// compare against, doing nothing is the only honest move.
//
// Bound against core.App rather than *pocketbase.PocketBase so the test suite
// binds THIS function, not a restatement of it.
func registerCommentEditedAt(app core.App) {
	app.OnRecordUpdate("boards_comments").BindFunc(func(e *core.RecordEvent) error {
		prior := e.Record.Original().GetString("body")
		if prior == "" {
			return e.Next()
		}
		if e.Record.GetString("body") != prior {
			e.Record.Set("edited_at", types.NowDateTime())
		} else {
			e.Record.Set("edited_at", e.Record.Original().GetDateTime("edited_at"))
		}
		return e.Next()
	})
}
