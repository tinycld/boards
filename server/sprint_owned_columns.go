package boards

import (
	"sync"

	"github.com/pocketbase/pocketbase/core"
)

// The server-owned columns on boards_sprints, and the one way to write them.
//
// A sprint carries three kinds of number a client must never set: the live
// rollup (sprint_rollup.go), the lifecycle stamps the start and complete
// transitions write (sprint_lifecycle.go), and the two timestamps beside
// them. None is a relation, so no access rule can pin any of them — the
// same gap card_number.go closes for `number` and due_notices.go closes for
// the notice stamps, and closed the same way: a client CREATE has them
// zeroed, a client UPDATE has them restored from the stored row, and the
// server's own saves announce themselves through saveSprintAsServer so the
// hook leaves them alone.
//
// Without this an editor could PATCH committed_points to anything, and the
// velocity chart would report it.
//
// `state` is NOT in this list, deliberately. A forged state is refused
// rather than silently restored (sprint_guard.go): a caller that tried to
// start a sprint by editing its state should be told to use Start sprint,
// not have the edit vanish.

// sprintServerWrites marks the saves the server itself makes — the rollup,
// the lifecycle, the sweep — keyed by record pointer, the actor.go
// convention: two requests for one row in flight at once must not read each
// other's mark.
var sprintServerWrites sync.Map // *core.Record → struct{}

// sprintOwnedColumns is every column the hook below protects. Dates and
// numbers both; `Set` with the original's typed value round-trips either.
var sprintOwnedColumns = []string{
	"started_at", "completed_at",
	"card_total", "card_done", "points_total", "points_done",
	"committed_count", "committed_points",
	"completed_count", "completed_points", "rolled_count",
}

// saveSprintAsServer saves a sprint with the mark set for the duration of the
// save, so the owned-column and state guards admit what the server wrote.
func saveSprintAsServer(app core.App, sprint *core.Record) error {
	sprintServerWrites.Store(sprint, struct{}{})
	defer sprintServerWrites.Delete(sprint)
	return app.Save(sprint)
}

func isSprintServerWrite(sprint *core.Record) bool {
	_, mine := sprintServerWrites.Load(sprint)
	return mine
}

func registerSprintOwnedColumns(app core.App) {
	app.OnRecordCreate("boards_sprints").BindFunc(func(e *core.RecordEvent) error {
		if isSprintServerWrite(e.Record) {
			return e.Next()
		}
		for _, column := range sprintOwnedColumns {
			e.Record.Set(column, nil)
		}
		return e.Next()
	})
	app.OnRecordUpdate("boards_sprints").BindFunc(func(e *core.RecordEvent) error {
		if isSprintServerWrite(e.Record) {
			return e.Next()
		}
		original := e.Record.Original()
		// The blank-Original guard from comment_edited.go: a record re-saved
		// without a reload has nothing to restore from, and `project` is
		// required, so blank means unknown rather than "was empty".
		if original.GetString("project") == "" {
			return e.Next()
		}
		for _, column := range sprintOwnedColumns {
			e.Record.Set(column, original.Get(column))
		}
		return e.Next()
	})
}
