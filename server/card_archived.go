package boards

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// registerCardArchivedAt owns boards_cards.archived_at — the timestamp the
// archived-items panel sorts by and renders.
//
// The column is SERVER-OWNED in fact, the same way comment_edited.go owns
// `edited_at`: no access rule pins a scalar field, so a client could otherwise
// archive a card while backdating the stamp, or clear it on a card that is
// still archived. Every direction is decided here from the stored row:
//
//   - archived flipped false → true: archived_at = now, overwriting the body.
//   - archived flipped true → false: archived_at = ”, the card is live again.
//   - archived unchanged: archived_at is restored from the stored row.
//
// The blank-Original guard mirrors comment_edited.go's: Save() does not
// refresh originalData in place, so a caller re-saving a record it already
// held arrives here with an empty Original. `archived` is a bool with no
// "unknown" value of its own, so `project` — required, never blank on a real
// row — is the sentinel.
//
// Bound against core.App rather than *pocketbase.PocketBase so the test suite
// binds THIS function, not a restatement of it.
func registerCardArchivedAt(app core.App) {
	app.OnRecordUpdate("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		original := e.Record.Original()
		if original.GetString("project") == "" {
			return e.Next()
		}
		was, now := original.GetBool("archived"), e.Record.GetBool("archived")
		switch {
		case now && !was:
			e.Record.Set("archived_at", types.NowDateTime())
		case was && !now:
			e.Record.Set("archived_at", "")
		default:
			e.Record.Set("archived_at", original.GetDateTime("archived_at"))
		}
		return e.Next()
	})
}
