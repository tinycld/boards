package boards

import (
	"sync"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// The sprint rollup: card_total / card_done / points_total / points_done on
// boards_sprints.
//
// epic_rollup.go's shape — bound on boards_cards, two recounts on an update
// (the sprint a card left and the one it joined, which also catches an
// estimate edit or a move into a done list), a per-sprint lock from the first
// commit, counters.go's recompute-never-delta and never-fail-the-write — with
// one difference in the arithmetic.
//
// POINTS ARE RAW: no 1-point floor for an unestimated card. A sprint carries
// a COUNT beside its points, and the header shows points only when the board
// estimates at all (points_total > 0), so the floor an epic needs to make its
// single ratio mean something is not needed here — and a velocity chart that
// silently counted every unestimated card as a point would overstate a team
// that estimates some cards and not others. Negative values are folded to 0,
// as normalizeEstimate reads them on the client.
//
// Archived cards are excluded from both halves, as epics exclude them: an
// archived card is off the board and neither done nor outstanding. The
// lifecycle stamps (committed_*, completed_*) are NOT written here — they are
// the sprint's numbers at a moment, not its numbers now.

var sprintRecountLocks sync.Map // sprintID → *sync.Mutex

func registerSprintRollup(app core.App) {
	app.OnRecordAfterCreateSuccess("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		recountSprint(e.App, e.Record.GetString("sprint"))
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		recountSprint(e.App, e.Record.Original().GetString("sprint"))
		recountSprint(e.App, e.Record.GetString("sprint"))
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		recountSprint(e.App, e.Record.GetString("sprint"))
		return e.Next()
	})
}

// sprintTotals is one sprint's live numbers.
type sprintTotals struct {
	cards, done, points, donePoints int
}

// recountSprint recomputes one sprint's four rollup columns. A missing sprint
// is not an error: deleting one leaves its cards pointing at a row that is
// gone, and each of those writes lands here.
func recountSprint(app core.App, sprintID string) {
	if sprintID == "" {
		return
	}

	gate, _ := sprintRecountLocks.LoadOrStore(sprintID, &sync.Mutex{})
	lock := gate.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()

	sprint, err := app.FindRecordById("boards_sprints", sprintID)
	if err != nil {
		return
	}

	totals, err := sumSprint(app, sprintID)
	if err != nil {
		app.Logger().Warn("boards: sprint recount failed", "sprint", sprintID, "error", err)
		return
	}

	// counters.go's no-op guard: every card write reaches here, and a write
	// that changes nothing still wakes every subscribed board client.
	if sprint.GetInt("card_total") == totals.cards &&
		sprint.GetInt("card_done") == totals.done &&
		sprint.GetInt("points_total") == totals.points &&
		sprint.GetInt("points_done") == totals.donePoints {
		return
	}

	sprint.Set("card_total", totals.cards)
	sprint.Set("card_done", totals.done)
	sprint.Set("points_total", totals.points)
	sprint.Set("points_done", totals.donePoints)

	// saveSprintAsServer — app.Save under the server mark, so realtime
	// broadcasts the row (epic_rollup.go's warning about DB().Update) and the
	// owned-column hook does not restore what was just computed.
	if err := saveSprintAsServer(app, sprint); err != nil {
		app.Logger().Warn("boards: sprint counter save failed", "sprint", sprintID, "error", err)
	}
}

// sumSprint reads a sprint's live totals in two queries: every unarchived
// card naming it, then the subset whose LIST is done or canceled — "done" is
// the list's category, as it is for subtask_done and an epic's points_done.
func sumSprint(app core.App, sprintID string) (sprintTotals, error) {
	var totals sprintTotals
	err := app.RecordQuery("boards_cards").
		Select("COUNT(*)", "COALESCE(SUM(MAX(estimate, 0)), 0)").
		AndWhere(dbx.HashExp{"sprint": sprintID, "archived": false}).
		Row(&totals.cards, &totals.points)
	if err != nil {
		return totals, err
	}
	err = app.RecordQuery("boards_cards").
		Select("COUNT(*)", "COALESCE(SUM(MAX(estimate, 0)), 0)").
		AndWhere(dbx.HashExp{"sprint": sprintID, "archived": false}).
		AndWhere(dbx.NewExp(
			"list IN (SELECT id FROM boards_lists WHERE category IN ('done', 'canceled'))",
		)).
		Row(&totals.done, &totals.donePoints)
	return totals, err
}
