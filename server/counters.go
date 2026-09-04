package cards

import (
	"sync"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// Board-face counters.
//
// cards_checklist_items, cards_comments and cards_attachments register with
// syncMode 'on-demand' (see tinycld/cards/collections.ts): a client fetches
// them only for the card it has open. That is right for the detail view and
// wrong for the board face, where every card wants to show "3/7", a comment
// count and a paperclip at rest. Rather than sync those collections eagerly —
// which would ship every comment on every board to every client — the counts
// are denormalized onto cards_cards here.
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
	for _, collection := range []string{"cards_checklist_items", "cards_comments", "cards_attachments"} {
		app.OnRecordAfterCreateSuccess(collection).BindFunc(func(e *core.RecordEvent) error {
			recountCard(e.App, e.Record.GetString("card"))
			return e.Next()
		})
		app.OnRecordAfterUpdateSuccess(collection).BindFunc(func(e *core.RecordEvent) error {
			// An is_done toggle changes checklist_done without changing
			// checklist_total, so update counts as much as create does.
			// Nothing an attachment update can change affects its count, but
			// binding it anyway costs one no-op recount that exits at the
			// unchanged check, and keeps all three collections symmetric.
			recountCard(e.App, e.Record.GetString("card"))
			return e.Next()
		})
		app.OnRecordAfterDeleteSuccess(collection).BindFunc(func(e *core.RecordEvent) error {
			recountCard(e.App, e.Record.GetString("card"))
			return e.Next()
		})
	}
}

// recountLocks serializes recountCard per card.
//
// The recount is a read-modify-write: FindRecordById, COUNT(*), Save. Nothing
// in that sequence is atomic, so two children created at the same instant can
// BOTH count before either row is visible and both write the same stale total
// — a lost update, and one that never heals, because the counter is only
// recomputed by the next child write.
//
// Not hypothetical: useDuplicateCard yields its checklist inserts as an ARRAY,
// which runs them in parallel, so duplicating a two-item card lands both
// creates at once and the copy's face reads "0/1" permanently.
//
// Per CARD rather than one global lock: recounts for different cards touch
// disjoint rows and should still run concurrently. The map only ever grows by
// the number of cards written concurrently, and LoadOrStore keeps that
// allocation-free on the common uncontended path.
var recountLocks sync.Map // cardID → *sync.Mutex

// recountCard recomputes every counter on one card from its children.
//
// A missing card is not an error: deleting a card cascades to its checklist
// items and comments, so this fires once per child with the parent already
// gone. That path is the common case, not an anomaly — return quietly.
func recountCard(app core.App, cardID string) {
	if cardID == "" {
		return
	}

	gate, _ := recountLocks.LoadOrStore(cardID, &sync.Mutex{})
	lock := gate.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()

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
	attachmentCount, err := countRows(app, "cards_attachments", dbx.HashExp{"card": cardID})
	if err != nil {
		app.Logger().Warn("cards: attachment recount failed", "card", cardID, "error", err)
		return
	}

	// Skip the write when nothing moved: every one of these hooks fires on
	// cascade deletes and on unrelated field updates, and a no-op Save would
	// bump `updated` and wake every subscribed board client for nothing.
	if card.GetInt("checklist_total") == checklistTotal &&
		card.GetInt("checklist_done") == checklistDone &&
		card.GetInt("comment_count") == commentCount &&
		card.GetInt("attachment_count") == attachmentCount {
		return
	}

	card.Set("checklist_total", checklistTotal)
	card.Set("checklist_done", checklistDone)
	card.Set("comment_count", commentCount)
	card.Set("attachment_count", attachmentCount)

	if err := app.Save(card); err != nil {
		app.Logger().Warn("cards: counter save failed", "card", cardID, "error", err)
	}
}

func countRows(app core.App, collection string, filter dbx.HashExp) (int, error) {
	var total int
	err := app.RecordQuery(collection).Select("COUNT(*)").AndWhere(filter).Row(&total)
	return total, err
}
