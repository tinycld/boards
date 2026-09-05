package boards

import (
	"errors"
	"fmt"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// The two sprint transitions, as functions the endpoints, the sweep and the
// seed all share — so a sprint started by a person, by the ticker on its
// start day, or by the seed script is the same sprint with the same stamps.
//
// START stamps the commitment: what the team signed up for, read from the
// live rollup at that moment. COMPLETE stamps what was finished, rolls every
// unfinished card to the next sprint, a new one, or the backlog, and marks
// the sprint completed. Both write a snapshot row, so a burndown has its
// first and last points even on a sprint the daily sweep never saw.
//
// "Ask, don't pick" applies to the rollover exactly as it does to a
// cross-board move's family: a sprint with unfinished work refuses to
// complete without an answer, because either answer moves work the caller
// cannot see from a confirm button.

const (
	rolloverNext    = "next"
	rolloverNew     = "new"
	rolloverBacklog = "backlog"
)

// errRolloverRequired is the refusal a caller turns into a 400 naming the
// choices — see handleCompleteSprint.
var errRolloverRequired = errors.New("the sprint has unfinished cards; say where they go")

// defaultSprintLengthDays mirrors lib/sprint.ts: a board whose setting is 0
// (never set) plans two-week sprints.
const defaultSprintLengthDays = 14

type sprintStartOptions struct {
	// Day values, "YYYY-MM-DD"; blank keeps the sprint's own, and a sprint
	// with neither starts today for the board's length.
	Start, End string
	// Blank keeps the sprint's own.
	Name, Goal string
}

type sprintRollover struct {
	// rolloverNext, rolloverNew or rolloverBacklog; blank when the caller
	// gave no answer, which is only acceptable with nothing to roll.
	Target string
	// The planned sprint to roll into, for rolloverNext.
	SprintID string
}

type completeSprintResult struct {
	CompletedCount  int
	CompletedPoints int
	RolledCount     int
	// The sprint the unfinished cards went to, "" for the backlog.
	TargetSprintID string
	CreatedSprint  bool
}

// utcDay is the day frame the sweep and the stamps share — the server's
// clock, as due_notices.go reads it. There is no user time zone in core.
func utcDay(now time.Time) time.Time {
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
}

func projectSprintLength(project *core.Record) int {
	if days := project.GetInt("sprint_length_days"); days > 0 {
		return days
	}
	return defaultSprintLengthDays
}

// startSprint moves a planned sprint to active as of `now`.
func startSprint(app core.App, sprint *core.Record, now time.Time, opts sprintStartOptions) error {
	if sprint.GetString("state") != sprintPlanned {
		return fmt.Errorf("only a planned sprint can start")
	}
	project, err := app.FindRecordById("boards_projects", sprint.GetString("project"))
	if err != nil {
		return fmt.Errorf("sprint %s has no board: %w", sprint.Id, err)
	}

	if opts.Name != "" {
		sprint.Set("name", opts.Name)
	}
	if opts.Goal != "" {
		sprint.Set("goal", opts.Goal)
	}
	if opts.Start != "" {
		sprint.Set("start", opts.Start)
	}
	if opts.End != "" {
		sprint.Set("end", opts.End)
	}
	// An undated sprint starts today for the board's length; a sprint with a
	// start and no end runs the board's length from its start.
	start := sprint.GetDateTime("start").Time()
	if sprint.GetDateTime("start").IsZero() {
		start = utcDay(now)
		sprint.Set("start", start.Format(pbDateFormat))
	}
	if sprint.GetDateTime("end").IsZero() {
		end := utcDay(start).AddDate(0, 0, projectSprintLength(project)-1)
		sprint.Set("end", end.Format(pbDateFormat))
	}

	totals, err := sumSprint(app, sprint.Id)
	if err != nil {
		return fmt.Errorf("sprint %s: read its cards: %w", sprint.Id, err)
	}
	sprint.Set("state", sprintActive)
	sprint.Set("started_at", types.NowDateTime())
	sprint.Set("committed_count", totals.cards)
	sprint.Set("committed_points", totals.points)
	sprint.Set("card_total", totals.cards)
	sprint.Set("card_done", totals.done)
	sprint.Set("points_total", totals.points)
	sprint.Set("points_done", totals.donePoints)
	if err := saveSprintAsServer(app, sprint); err != nil {
		return err
	}
	writeSprintSnapshot(app, sprint, utcDay(now), totals)
	return nil
}

// unfinishedSprintCards is what a completion rolls: the sprint's live cards
// whose list is still open. Archived cards are neither finished nor rolled.
func unfinishedSprintCards(app core.App, sprintID string) ([]*core.Record, error) {
	return app.FindRecordsByFilter(
		"boards_cards",
		"sprint = {:sprint} && archived = false"+
			" && list.category != 'done' && list.category != 'canceled'",
		"position,id", 0, 0,
		dbx.Params{"sprint": sprintID},
	)
}

// completeSprint closes an active sprint as of `now`, in one transaction.
//
// `actor` is the user completing it, "" for the sweep; it is what the
// rolled cards' history rows carry. The card saves are marked as owning
// their relation history (activity.go) so the after-success diff does not
// write a second, unattributed row per card.
func completeSprint(
	app core.App,
	sprint *core.Record,
	now time.Time,
	actor string,
	rollover sprintRollover,
) (completeSprintResult, error) {
	var result completeSprintResult
	if sprint.GetString("state") != sprintActive {
		return result, fmt.Errorf("only an active sprint can complete")
	}
	unfinished, err := unfinishedSprintCards(app, sprint.Id)
	if err != nil {
		return result, fmt.Errorf("sprint %s: read its cards: %w", sprint.Id, err)
	}
	if len(unfinished) > 0 {
		switch rollover.Target {
		case rolloverNext, rolloverNew, rolloverBacklog:
		default:
			return result, errRolloverRequired
		}
	}

	// The rollover writes each card's `sprint` row itself, with the actor.
	// The mark must outlive the transaction: the after-success hook that
	// would write the unattributed duplicate fires on commit, not on Save.
	for _, card := range unfinished {
		release := ownRelationHistory(card)
		defer release()
	}

	err = app.RunInTransaction(func(tx core.App) error {
		totals, err := sumSprint(tx, sprint.Id)
		if err != nil {
			return err
		}

		target := ""
		if len(unfinished) > 0 {
			switch rollover.Target {
			case rolloverNext:
				next, err := plannedSprintOnBoard(tx, sprint.GetString("project"), rollover.SprintID)
				if err != nil {
					return err
				}
				target = next.Id
			case rolloverNew:
				// Inside the transaction, for endpoints_move_card.go's reason: a
				// sprint that survived a failed completion would be an empty
				// sprint nobody asked for.
				next, err := createFollowingSprint(tx, sprint, actor)
				if err != nil {
					return err
				}
				target = next.Id
				result.CreatedSprint = true
			}
		}

		for _, card := range unfinished {
			card.Set("sprint", target)
			if err := tx.Save(card); err != nil {
				return err
			}
			writeActivity(tx, card, actor, "sprint", sprint.Id, target)
		}

		sprint.Set("state", sprintCompleted)
		sprint.Set("completed_at", types.NowDateTime())
		sprint.Set("completed_count", totals.done)
		sprint.Set("completed_points", totals.donePoints)
		sprint.Set("rolled_count", len(unfinished))
		if err := saveSprintAsServer(tx, sprint); err != nil {
			return err
		}
		// The closing point of the burndown: the scope as it stood, and what
		// of it was done. Written before the rollup recounts the emptied sprint.
		writeSprintSnapshot(tx, sprint, utcDay(now), totals)

		result.CompletedCount = totals.done
		result.CompletedPoints = totals.donePoints
		result.RolledCount = len(unfinished)
		result.TargetSprintID = target
		return nil
	})
	return result, err
}

// plannedSprintOnBoard resolves the sprint a rollover names, refusing one on
// another board or one that is not planned.
func plannedSprintOnBoard(app core.App, projectID, sprintID string) (*core.Record, error) {
	if sprintID == "" {
		return nil, fmt.Errorf("rolling to the next sprint needs its id")
	}
	next, err := app.FindRecordById("boards_sprints", sprintID)
	if err != nil {
		return nil, fmt.Errorf("next sprint %s: %w", sprintID, err)
	}
	if next.GetString("project") != projectID {
		return nil, fmt.Errorf("next sprint %s is on another board", sprintID)
	}
	if next.GetString("state") != sprintPlanned {
		return nil, fmt.Errorf("next sprint %s is not planned", sprintID)
	}
	return next, nil
}

// nextPlannedSprint is the first planned sprint by rank, or nil.
func nextPlannedSprint(app core.App, projectID string) (*core.Record, error) {
	rows, err := app.FindRecordsByFilter(
		"boards_sprints", "project = {:project} && state = 'planned'",
		"position,id", 1, 0, dbx.Params{"project": projectID},
	)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// createFollowingSprint plans the sprint after `previous`: unnamed, dated
// from the day after it ends for the board's length, ranked after every
// planned sprint. The number is the allocator's (sprint_number.go).
func createFollowingSprint(app core.App, previous *core.Record, actor string) (*core.Record, error) {
	project, err := app.FindRecordById("boards_projects", previous.GetString("project"))
	if err != nil {
		return nil, err
	}
	col, err := app.FindCollectionByNameOrId("boards_sprints")
	if err != nil {
		return nil, err
	}
	last, err := app.FindRecordsByFilter(
		"boards_sprints", "project = {:project} && state = 'planned'",
		"-position,-id", 1, 0, dbx.Params{"project": project.Id},
	)
	if err != nil {
		return nil, err
	}
	after := ""
	if len(last) > 0 {
		after = last[0].GetString("position")
	}
	position, err := rankAfter(after)
	if err != nil {
		return nil, err
	}

	next := core.NewRecord(col)
	next.Set("project", project.Id)
	next.Set("state", sprintPlanned)
	next.Set("position", position)
	next.Set("created_by", actor)
	if end := previous.GetDateTime("end"); !end.IsZero() {
		start := utcDay(end.Time()).AddDate(0, 0, 1)
		next.Set("start", start.Format(pbDateFormat))
		next.Set("end", start.AddDate(0, 0, projectSprintLength(project)-1).Format(pbDateFormat))
	}
	if err := saveSprintAsServer(app, next); err != nil {
		return nil, err
	}
	return next, nil
}

// writeSprintSnapshot records one day's scope and progress, one row per
// sprint per day (the unique index): a later write for the same day updates
// the row, so the sweep and a same-day transition agree on one point.
// Never fails the caller: a snapshot is worth having, not worth refusing a
// completion over.
func writeSprintSnapshot(app core.App, sprint *core.Record, day time.Time, totals sprintTotals) {
	dayValue := day.Format(pbDateFormat)
	rows, err := app.FindRecordsByFilter(
		"boards_sprint_snapshots", "sprint = {:sprint} && day = {:day}",
		"", 1, 0, dbx.Params{"sprint": sprint.Id, "day": dayValue},
	)
	if err != nil {
		activityLog.Warn("sprint snapshot read failed", "sprint", sprint.Id, "error", err)
		return
	}
	var row *core.Record
	if len(rows) > 0 {
		row = rows[0]
	} else {
		col, err := app.FindCollectionByNameOrId("boards_sprint_snapshots")
		if err != nil {
			activityLog.Warn("sprint snapshot collection missing", "error", err)
			return
		}
		row = core.NewRecord(col)
		row.Set("sprint", sprint.Id)
		row.Set("project", sprint.GetString("project"))
		row.Set("day", dayValue)
	}
	row.Set("scope_count", totals.cards)
	row.Set("scope_points", totals.points)
	row.Set("done_count", totals.done)
	row.Set("done_points", totals.donePoints)
	if err := app.Save(row); err != nil {
		activityLog.Warn("sprint snapshot write failed", "sprint", sprint.Id, "error", err)
	}
}
