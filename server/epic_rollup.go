package cards

import (
	"sync"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// The epic points rollup: points_total / points_done on cards_epics.
//
// card_parent.go's registerCardParentRollup shape, with two differences.
//
// POINTS, NOT COUNTS, and an unestimated card is worth 1. Counting cards would
// throw away the sizing a board already did; summing raw estimates would read
// "0 pts" on the many boards that never estimate. The 1-point floor makes one
// number correct on both, so there is no display branch and no preference to
// set. lib/estimate.ts applies the same floor, so a column header and an epic
// never disagree about the same cards — see 1980000017 for the full argument.
//
// A PER-EPIC LOCK, from the first commit. The recount is a read-modify-write
// (find, sum, save) exactly as counters.go's is, and counters.go shipped
// without one: parallel child writes both summed before either row was
// visible, and the second Save clobbered the first with a stale total. The
// duplicate-card path made that reachable in production. Nothing about epics
// is safer — a bulk re-file writes many cards at once — so the lock is here
// rather than after the bug.

// epicRecountLocks serializes recountEpic per epic. Per EPIC rather than one
// global lock: different epics touch disjoint rows and should still recount
// concurrently. counters.go's recountLocks, same reasoning.
var epicRecountLocks sync.Map // epicID → *sync.Mutex

// registerEpicRollup keeps points_total / points_done current.
//
// The re-file case is why the update hook recounts TWO epics: a card moving
// between epics changes both the one it left and the one it joined, and the
// old id survives only on Original(). card_parent.go's registerCardParentRollup
// has the same shape for the same reason.
//
// A DELETE has no Original(), so the row itself carries the epic to recount.
// Cards are not cascade-deleted by their epic (cascadeDelete: false,
// deliberately), so this fires once per card.
//
// Bound on cards_cards only. An epic's own row carries the counters but never
// contributes to them, so writing an epic cannot change any total.
func registerEpicRollup(app core.App) {
	app.OnRecordAfterCreateSuccess("cards_cards").BindFunc(func(e *core.RecordEvent) error {
		recountEpic(e.App, e.Record.GetString("epic"))
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("cards_cards").BindFunc(func(e *core.RecordEvent) error {
		// Both epics: the one this card left, and the one it joined. When the
		// epic did not change these are the same id and the second call exits
		// at the unchanged check.
		//
		// This also covers the two OTHER ways a total moves without the epic
		// changing at all — an estimate edited, or a card moved into a done
		// list — because both are updates to a card that names the epic.
		recountEpic(e.App, e.Record.Original().GetString("epic"))
		recountEpic(e.App, e.Record.GetString("epic"))
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("cards_cards").BindFunc(func(e *core.RecordEvent) error {
		recountEpic(e.App, e.Record.GetString("epic"))
		return e.Next()
	})
}

// recountEpic recomputes one epic's points from the cards filed under it.
//
// counters.go's invariants, restated because they are as load-bearing here:
// RECOMPUTE (never delta), and never fail the caller's write.
//
// A missing epic is not an error. Deleting an epic leaves its cards pointing
// at a row that is gone, and each of those writes lands here with the epic
// already absent — the common path, not an anomaly.
func recountEpic(app core.App, epicID string) {
	if epicID == "" {
		return
	}

	gate, _ := epicRecountLocks.LoadOrStore(epicID, &sync.Mutex{})
	lock := gate.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()

	epic, err := app.FindRecordById("cards_epics", epicID)
	if err != nil {
		return
	}

	total, err := sumEpicPoints(app, epicID, false)
	if err != nil {
		app.Logger().Warn("cards: epic points recount failed", "epic", epicID, "error", err)
		return
	}
	done, err := sumEpicPoints(app, epicID, true)
	if err != nil {
		app.Logger().Warn("cards: epic done-points recount failed", "epic", epicID, "error", err)
		return
	}

	// counters.go's no-op guard: every card write reaches here, and a write
	// that changes nothing still wakes every subscribed board client.
	if epic.GetInt("points_total") == total && epic.GetInt("points_done") == done {
		return
	}

	// app.Save, NOT a raw DB().Update of just these two columns — writing
	// through the DB layer bypasses PocketBase's realtime broadcast, so the
	// row changes on disk and no client is told. card_parent.go records the
	// full story; that bug was invisible to every Go test and visible only in
	// a browser.
	epic.Set("points_total", total)
	epic.Set("points_done", done)

	if err := app.Save(epic); err != nil {
		app.Logger().Warn("cards: epic counter save failed", "epic", epicID, "error", err)
	}
}

// sumEpicPoints totals the points of the cards filed under one epic, counting
// an unestimated card as 1.
//
// MAX(estimate, 1) rather than COALESCE: PocketBase reads an omitted number
// back as 0, not NULL (lib/estimate.ts's opening note), so "unset" arrives
// here as 0 and a COALESCE would never fire. MAX also folds away the negative
// values normalizeEstimate treats as unset on the client.
//
// Archived cards are excluded from BOTH totals: an archived card is off the
// board, and counting it would leave an epic that can never reach 100% — the
// archived work is neither done nor outstanding.
//
// `closed` selects the done half. "Done" is the LIST's status category, not a
// flag on the card — `is_done` was retired in 1980000011 — so an epic's
// progress agrees with the list header glyph a reader is looking at. A list
// whose category is ” counts as `todo` (never closed), matching listCategory()
// and lib/list-category.ts.
func sumEpicPoints(app core.App, epicID string, closed bool) (int, error) {
	var total int
	query := app.RecordQuery("cards_cards").
		Select("COALESCE(SUM(MAX(estimate, 1)), 0)").
		AndWhere(dbx.HashExp{"epic": epicID, "archived": false})
	if closed {
		query = query.AndWhere(dbx.NewExp(
			"list IN (SELECT id FROM cards_lists WHERE category IN ('done', 'canceled'))",
		))
	}
	err := query.Row(&total)
	return total, err
}
