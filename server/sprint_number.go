package boards

import (
	"github.com/pocketbase/pocketbase/core"
)

// Per-board sprint numbers — the 4 in "Sprint 4".
//
// card_number.go's allocator over a second counter, boards_projects.
// next_sprint_number, and every invariant recorded there holds here:
// monotonic and never reused (a deleted Sprint 3 must not hand its number to
// the next sprint created, or "Sprint 3" in a card's history quietly changes
// meaning), assigned BEFORE the row lands so the insert carries it, and it
// FAILS the write when it cannot allocate — a sprint with no number cannot be
// named, listed or addressed from the CLI.
//
// There is no re-key half: a sprint is pinned to its board by rule
// (1980000018) and no server path moves one, so the number it was born with
// is the number it keeps.
func registerSprintNumbers(app core.App) {
	app.OnRecordCreate("boards_sprints").BindFunc(func(e *core.RecordEvent) error {
		// A client-supplied number is ignored, never trusted, for the reason
		// card_number.go gives: no rule pins a scalar, so overwriting
		// unconditionally is what makes the column server-owned in fact.
		n, err := allocateCounter(e.App, e.Record.GetString("project"), "next_sprint_number")
		if err != nil {
			return err
		}
		e.Record.Set("number", n)
		return e.Next()
	})
}
