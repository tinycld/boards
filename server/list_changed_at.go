package boards

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// registerListChangedAt owns boards_cards.list_changed_at — when the card
// entered the list it is in, which is the clock auto_archive.go counts from.
//
// SERVER-OWNED the way archived_at is (card_archived.go): no access rule pins
// a scalar field, so a client could otherwise backdate the stamp to age a
// finished card into the sweep, or refresh it to keep one out. Every
// direction is decided here from the stored row:
//
//   - a create: now.
//   - `list` changed: now, overwriting whatever the body carried.
//   - `list` unchanged: restored from the stored row.
//
// The blank-Original guard is card_archived.go's: a record re-saved without a
// reload has an empty Original, and `project` — required, never blank on a
// real row — is the sentinel.
func registerListChangedAt(app core.App) {
	app.OnRecordCreate("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		e.Record.Set("list_changed_at", types.NowDateTime())
		return e.Next()
	})
	app.OnRecordUpdate("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		original := e.Record.Original()
		if original.GetString("project") == "" {
			return e.Next()
		}
		if original.GetString("list") != e.Record.GetString("list") {
			e.Record.Set("list_changed_at", types.NowDateTime())
		} else {
			e.Record.Set("list_changed_at", original.GetDateTime("list_changed_at"))
		}
		return e.Next()
	})
}
