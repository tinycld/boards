package boards

import (
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// The sprint sweep: on boards that plan in sprints, the daily snapshot every
// active sprint's burndown reads, and — where the board asked for it — the
// two automatic transitions. auto_archive.go's shape: a quarter-hour ticker,
// the clock as a parameter, never failing; a sprint that cannot transition
// is logged and left for the next sweep.
//
// The transitions are the SAME functions the endpoints run, so a sprint the
// ticker starts carries the same stamps as one a person started — and the
// same after-update hook fires, which is what turns the `state` change into
// the boards:sprint-started trigger and the boards_sprint notice with no
// scheduling machinery of their own (the deadline triggers' trick).
//
// Day frame: the server's UTC day, as due_notices.go reads it. A sprint
// ending on the 14th completes on the sweep's first pass on the 15th.

const sprintSweepInterval = 15 * time.Minute

func startSprintScheduler(app core.App) {
	ticker := time.NewTicker(sprintSweepInterval)
	defer ticker.Stop()
	sweepSprints(app, time.Now())
	for range ticker.C {
		if !cardsAppIsLive(app) {
			return
		}
		sweepSprints(app, time.Now())
	}
}

// sweepSprints runs one sweep as of `now`.
func sweepSprints(app core.App, now time.Time) {
	if !cardsAppIsLive(app) {
		return
	}
	projects, err := app.FindRecordsByFilter(
		"boards_projects", "archived = false && sprints_enabled = true", "", 0, 0)
	if err != nil {
		activityLog.Warn("sprint sweep: project read failed", "error", err)
		return
	}
	today := utcDay(now)
	for _, project := range projects {
		sweepProjectSprints(app, project, now, today)
	}
}

func sweepProjectSprints(app core.App, project *core.Record, now, today time.Time) {
	active, err := activeSprintOnBoard(app, project.Id)
	if err != nil {
		activityLog.Warn("sprint sweep: active sprint read failed", "project", project.Id, "error", err)
		return
	}

	if active != nil {
		snapshotToday(app, active, today)
		end := active.GetDateTime("end")
		if project.GetBool("sprint_auto_complete") && !end.IsZero() && utcDay(end.Time()).Before(today) {
			rollover := sprintRollover{Target: rolloverBacklog}
			if project.GetString("sprint_rollover") != rolloverBacklog {
				// "next": the next planned sprint, or a new one when none is planned.
				next, err := nextPlannedSprint(app, project.Id)
				if err != nil {
					activityLog.Warn("sprint sweep: next sprint read failed", "project", project.Id, "error", err)
					return
				}
				if next != nil {
					rollover = sprintRollover{Target: rolloverNext, SprintID: next.Id}
				} else {
					rollover = sprintRollover{Target: rolloverNew}
				}
			}
			if _, err := completeSprint(app, active, now, "", rollover); err != nil {
				activityLog.Warn("sprint sweep: auto-complete failed", "sprint", active.Id, "error", err)
				return
			}
			active = nil
		}
	}

	if active == nil && project.GetBool("sprint_auto_start") {
		due, err := app.FindRecordsByFilter(
			"boards_sprints",
			"project = {:project} && state = 'planned' && start != '' && start <= {:today}",
			"start,position,id", 1, 0,
			dbx.Params{"project": project.Id, "today": today.Format(pbDateFormat)},
		)
		if err != nil {
			activityLog.Warn("sprint sweep: planned sprint read failed", "project", project.Id, "error", err)
			return
		}
		if len(due) == 0 {
			return
		}
		if err := startSprint(app, due[0], now, sprintStartOptions{}); err != nil {
			activityLog.Warn("sprint sweep: auto-start failed", "sprint", due[0].Id, "error", err)
		}
	}
}

func activeSprintOnBoard(app core.App, projectID string) (*core.Record, error) {
	rows, err := app.FindRecordsByFilter(
		"boards_sprints", "project = {:project} && state = 'active'",
		"", 1, 0, dbx.Params{"project": projectID},
	)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// snapshotToday writes today's point once; the unique (sprint, day) index
// and writeSprintSnapshot's upsert make a repeat pass a no-op write.
func snapshotToday(app core.App, sprint *core.Record, today time.Time) {
	n, err := app.CountRecords("boards_sprint_snapshots",
		dbx.HashExp{"sprint": sprint.Id, "day": today.Format(pbDateFormat)})
	if err != nil || n > 0 {
		return
	}
	totals, err := sumSprint(app, sprint.Id)
	if err != nil {
		activityLog.Warn("sprint sweep: totals read failed", "sprint", sprint.Id, "error", err)
		return
	}
	writeSprintSnapshot(app, sprint, today, totals)
}
