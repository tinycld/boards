package cards

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// Board-face counters.
//
// cards_checklist_items and cards_comments register with syncMode 'on-demand'
// (see tinycld/cards/collections.ts): a client fetches them only for the card
// it has open. That is right for the detail view and wrong for the board face,
// where every card wants to show "3/7" and a comment count at rest. Rather than
// sync those collections eagerly — which would ship every comment on every
// board to every client — the counts are denormalized onto cards_cards here.
//
// Two invariants, both learned the hard way elsewhere:
//
//   - RECOMPUTE, never delta. An increment/decrement pair drifts silently the
//     moment two writes race, and a wrong badge is a bug nobody files. A
//     COUNT(*) scoped to one card is cheap at kanban scale.
//   - Never fail the user's write. A counter is display state; if the recount
//     fails, the checklist item the user just added still exists and the badge
//     is stale until the next event. Log and move on.
//
// These run post-success and write with app.Save on a freshly fetched record,
// bypassing access rules deliberately: the caller has already been authorized
// for the child write by the rules, and the parent card is not theirs to be
// re-checked against here.

func registerBoardCounters(app *pocketbase.PocketBase) {
	for _, collection := range []string{"cards_checklist_items", "cards_comments"} {
		app.OnRecordAfterCreateSuccess(collection).BindFunc(func(e *core.RecordEvent) error {
			recountCard(e.App, e.Record.GetString("card"))
			return e.Next()
		})
		app.OnRecordAfterUpdateSuccess(collection).BindFunc(func(e *core.RecordEvent) error {
			// An is_done toggle changes checklist_done without changing
			// checklist_total, so update counts as much as create does.
			recountCard(e.App, e.Record.GetString("card"))
			return e.Next()
		})
		app.OnRecordAfterDeleteSuccess(collection).BindFunc(func(e *core.RecordEvent) error {
			recountCard(e.App, e.Record.GetString("card"))
			return e.Next()
		})
	}
}

// recountCard recomputes every counter on one card from its children.
//
// A missing card is not an error: deleting a card cascades to its checklist
// items and comments, so this fires once per child with the parent already
// gone. That path is the common case, not an anomaly — return quietly.
func recountCard(app core.App, cardID string) {
	if cardID == "" {
		return
	}

	card, err := app.FindRecordById("cards_cards", cardID)
	if err != nil {
		return
	}

	checklistTotal, err := countRows(app, "cards_checklist_items", dbx.HashExp{"card": cardID})
	if err != nil {
		app.Logger().Warn("cards: checklist recount failed", "card", cardID, "error", err)
		return
	}
	checklistDone, err := countRows(app, "cards_checklist_items", dbx.HashExp{"card": cardID, "is_done": true})
	if err != nil {
		app.Logger().Warn("cards: checklist-done recount failed", "card", cardID, "error", err)
		return
	}
	commentCount, err := countRows(app, "cards_comments", dbx.HashExp{"card": cardID})
	if err != nil {
		app.Logger().Warn("cards: comment recount failed", "card", cardID, "error", err)
		return
	}

	// Skip the write when nothing moved: every one of these hooks fires on
	// cascade deletes and on unrelated field updates, and a no-op Save would
	// bump `updated` and wake every subscribed board client for nothing.
	if card.GetInt("checklist_total") == checklistTotal &&
		card.GetInt("checklist_done") == checklistDone &&
		card.GetInt("comment_count") == commentCount {
		return
	}

	card.Set("checklist_total", checklistTotal)
	card.Set("checklist_done", checklistDone)
	card.Set("comment_count", commentCount)

	if err := app.Save(card); err != nil {
		app.Logger().Warn("cards: counter save failed", "card", cardID, "error", err)
	}
}

func countRows(app core.App, collection string, filter dbx.HashExp) (int, error) {
	var total int
	err := app.RecordQuery(collection).Select("COUNT(*)").AndWhere(filter).Row(&total)
	return total, err
}
