package cards

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Card watchers: who is told when a card they follow changes.
//
// People become watchers two ways. Explicitly, through the Watch button —
// a cards_card_watchers row the client inserts for itself. And AUTOMATICALLY,
// here, on the actions that make someone a party to a card: creating it,
// being set as its reporter, being assigned, commenting on it. That is the
// Jira convention, and it is what makes the notification story hold without
// asking anyone to opt in: the person who filed a card hears when it moves.
//
// Re-commenting after an explicit unwatch re-watches — documented in the help
// topic, and deliberate: a new comment is a new declaration of interest.
//
// Server-side (app.Save) rather than a client insert alongside each action,
// so the CLI, automation and every other write path get the same behaviour.
// ensureWatcher is idempotent on the unique (card, user) index.

func registerAutoWatch(app core.App) {
	app.OnRecordAfterCreateSuccess("cards_cards").BindFunc(func(e *core.RecordEvent) error {
		card := e.Record
		ensureWatcher(app, card.GetString("project"), card.Id, card.GetString("created_by"))
		ensureWatcher(app, card.GetString("project"), card.Id, card.GetString("reporter"))
		for _, id := range card.GetStringSlice("assignees") {
			ensureWatcher(app, card.GetString("project"), card.Id, id)
		}
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("cards_cards").BindFunc(func(e *core.RecordEvent) error {
		card := e.Record
		original := card.Original()
		if original.GetString("project") == "" {
			return e.Next()
		}
		added, _ := setDiff(original.GetStringSlice("assignees"), card.GetStringSlice("assignees"))
		for _, id := range added {
			ensureWatcher(app, card.GetString("project"), card.Id, id)
		}
		if to := card.GetString("reporter"); to != "" && to != original.GetString("reporter") {
			ensureWatcher(app, card.GetString("project"), card.Id, to)
		}
		return e.Next()
	})
	app.OnRecordAfterCreateSuccess("cards_comments").BindFunc(func(e *core.RecordEvent) error {
		comment := e.Record
		ensureWatcher(app, comment.GetString("project"), comment.GetString("card"), comment.GetString("author"))
		return e.Next()
	})
}

// ensureWatcher adds a watcher row unless one exists. Never fails the write it
// rides on: a missing watcher costs a notification, not the card change.
func ensureWatcher(app core.App, projectID, cardID, userID string) {
	if projectID == "" || cardID == "" || userID == "" {
		return
	}
	// Only members watch: a card assigned to someone who since left the board
	// must not keep paging them.
	member, err := app.CountRecords("cards_project_members",
		dbx.HashExp{"project": projectID, "user": userID})
	if err != nil || member == 0 {
		return
	}
	existing, err := app.CountRecords("cards_card_watchers",
		dbx.HashExp{"card": cardID, "user": userID})
	if err != nil || existing > 0 {
		return
	}
	col, err := app.FindCollectionByNameOrId("cards_card_watchers")
	if err != nil {
		return
	}
	row := core.NewRecord(col)
	row.Set("project", projectID)
	row.Set("card", cardID)
	row.Set("user", userID)
	if err := app.Save(row); err != nil {
		activityLog.Warn("auto-watch failed", "card", cardID, "user", userID, "error", err)
	}
}

// watcherIDs returns the users following a card.
func watcherIDs(app core.App, cardID string) []string {
	rows, err := app.FindRecordsByFilter("cards_card_watchers", "card = {:card}", "", 0, 0,
		dbx.Params{"card": cardID})
	if err != nil {
		return nil
	}
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.GetString("user"))
	}
	return out
}
