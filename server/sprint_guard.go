package boards

import (
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// The sprint invariants a rule cannot express. FAILS THE WRITE, the
// card_parent.go posture: an out-of-order sprint or two active at once is
// corruption, not display state.
//
//   - A sprint is CREATED PLANNED. Starting is a transition with stamps
//     and a snapshot (sprint_lifecycle.go), not a field edit.
//   - A sprint only moves FORWARD: planned → active → completed. A rule sees
//     the incoming row but not the stored one, so it cannot compare.
//   - A client does not change `state` at all — the transitions do, through
//     saveSprintAsServer. Refused rather than restored (see
//     sprint_owned_columns.go for why the numbers are restored instead).
//   - At most ONE ACTIVE sprint per board. A rule sees one row and cannot
//     count its siblings.
//   - Dates are ordered, and an active sprint has both.
//   - A card joins only a PLANNED or ACTIVE sprint. The same-board half of
//     that invariant is the pin in 1980000018; this is the state half, which
//     needs the sprint row read.
//
// The same-board invariant on the sprint's own `project` is the rule's
// (pinProject); nothing here restates it.

const (
	sprintPlanned   = "planned"
	sprintActive    = "active"
	sprintCompleted = "completed"
)

func registerSprintGuard(app core.App) {
	app.OnRecordCreate("boards_sprints").BindFunc(func(e *core.RecordEvent) error {
		if err := checkSprintCreate(e.Record); err != nil {
			return err
		}
		return e.Next()
	})
	app.OnRecordUpdate("boards_sprints").BindFunc(func(e *core.RecordEvent) error {
		if err := checkSprintUpdate(e.App, e.Record); err != nil {
			return err
		}
		return e.Next()
	})
	app.OnRecordCreate("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		if err := checkCardSprint(e.App, e.Record); err != nil {
			return err
		}
		return e.Next()
	})
	app.OnRecordUpdate("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		if err := checkCardSprint(e.App, e.Record); err != nil {
			return err
		}
		return e.Next()
	})
}

func checkSprintCreate(sprint *core.Record) error {
	if sprint.GetString("state") != sprintPlanned {
		return fmt.Errorf("a sprint is created as planned; start it with Start sprint")
	}
	return checkSprintDates(sprint)
}

func checkSprintUpdate(app core.App, sprint *core.Record) error {
	original := sprint.Original()
	// The blank-Original guard: a record re-saved without a reload cannot
	// prove a transition happened, so only the shape is checked.
	if original.GetString("project") == "" {
		return checkSprintDates(sprint)
	}
	from, to := original.GetString("state"), sprint.GetString("state")
	if from != to {
		if !isSprintServerWrite(sprint) {
			return fmt.Errorf("a sprint is started or completed, not edited into a state")
		}
		forward := (from == sprintPlanned && to == sprintActive) ||
			(from == sprintActive && to == sprintCompleted)
		if !forward {
			return fmt.Errorf("a sprint only moves forward: planned, then active, then completed")
		}
		if to == sprintActive {
			if err := checkNoOtherActiveSprint(app, sprint); err != nil {
				return err
			}
		}
	}
	return checkSprintDates(sprint)
}

// checkNoOtherActiveSprint refuses a second active sprint on a board. Read at
// the moment of the transition rather than kept as a flag on the project,
// so a sprint completed by a racing request is not still counted.
func checkNoOtherActiveSprint(app core.App, sprint *core.Record) error {
	n, err := app.CountRecords("boards_sprints", dbx.And(
		dbx.HashExp{"project": sprint.GetString("project"), "state": sprintActive},
		dbx.Not(dbx.HashExp{"id": sprint.Id}),
	))
	if err != nil {
		return fmt.Errorf("could not check the board's active sprint: %w", err)
	}
	if n > 0 {
		return fmt.Errorf("another sprint is already active on this board; complete it first")
	}
	return nil
}

func checkSprintDates(sprint *core.Record) error {
	start, end := sprint.GetDateTime("start"), sprint.GetDateTime("end")
	if sprint.GetString("state") == sprintActive && (start.IsZero() || end.IsZero()) {
		return fmt.Errorf("an active sprint needs a start and an end date")
	}
	if !start.IsZero() && !end.IsZero() && end.Time().Before(start.Time()) {
		return fmt.Errorf("a sprint cannot end before it starts")
	}
	return nil
}

// checkCardSprint refuses filing a card into a completed sprint.
//
// Only a CHANGE is checked: a card already in a sprint that has since
// completed must stay editable (its title, its list), or completing a sprint
// would freeze every card it finished. A sprint that cannot be loaded is
// passed through rather than refused here — PocketBase's relation validator
// already rejects an id that names no row, so this branch is only ever
// reached by a racing delete, and card_parent.go's reasoning applies.
func checkCardSprint(app core.App, card *core.Record) error {
	sprintID := card.GetString("sprint")
	if sprintID == "" {
		return nil
	}
	original := card.Original()
	if original.GetString("project") != "" && original.GetString("sprint") == sprintID {
		return nil
	}
	sprint, err := app.FindRecordById("boards_sprints", sprintID)
	if err != nil {
		return nil
	}
	if sprint.GetString("state") == sprintCompleted {
		return fmt.Errorf("that sprint is completed; a card can only join a planned or active sprint")
	}
	return nil
}
