package boards

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// The sprint sweep with a fixed clock: the daily snapshot, and the two
// automatic transitions only where the board asked for them.

func setupSweepEnv(t *testing.T, autoStart, autoComplete bool, rollover string) *lifecycleEnv {
	t.Helper()
	env := setupLifecycleEnv(t)
	env.project.Set("sprints_enabled", true)
	env.project.Set("sprint_auto_start", autoStart)
	env.project.Set("sprint_auto_complete", autoComplete)
	env.project.Set("sprint_rollover", rollover)
	if err := env.app.Save(env.project); err != nil {
		t.Fatal(err)
	}
	return env
}

func datedSprint(t *testing.T, env *lifecycleEnv, name, position, start, end string) *core.Record {
	t.Helper()
	sprint := cardsSprint(t, env.app, env.project, name, position)
	fresh := reloadSprint(t, env.app, sprint.Id)
	fresh.Set("start", start)
	fresh.Set("end", end)
	if err := saveSprintAsServer(env.app, fresh); err != nil {
		t.Fatal(err)
	}
	return fresh
}

func TestSprintSweep_SnapshotsTheActiveSprintOncePerDay(t *testing.T) {
	env := setupSweepEnv(t, false, false, "next")
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	sprintCard(t, env.cardsEnv, sprint, env.list, "work", "a1", 3)
	if err := startSprint(env.app, sprint, env.now, sprintStartOptions{}); err != nil {
		t.Fatal(err)
	}
	// The start wrote today's point; the sweep on the same day adds nothing.
	sweepSprints(env.app, env.now)
	sweepSprints(env.app, env.now.Add(2*time.Hour))
	if n := snapshotCount(t, env.app, sprint.Id); n != 1 {
		t.Fatalf("snapshots after two same-day sweeps = %d, want 1", n)
	}
	sweepSprints(env.app, env.now.AddDate(0, 0, 1))
	if n := snapshotCount(t, env.app, sprint.Id); n != 2 {
		t.Fatalf("snapshots after the next day's sweep = %d, want 2", n)
	}
}

func TestSprintSweep_AutoStartsOnTheStartDayOnly(t *testing.T) {
	env := setupSweepEnv(t, true, false, "next")
	today := datedSprint(t, env, "Today", "a0", "2026-09-04 00:00:00.000Z", "2026-09-17 00:00:00.000Z")
	tomorrow := datedSprint(t, env, "Tomorrow", "a1", "2026-09-05 00:00:00.000Z", "2026-09-18 00:00:00.000Z")

	sweepSprints(env.app, env.now)

	if reloadSprint(t, env.app, today.Id).GetString("state") != sprintActive {
		t.Fatal("a planned sprint whose start day has come was not started")
	}
	if reloadSprint(t, env.app, tomorrow.Id).GetString("state") != sprintPlanned {
		t.Fatal("a sprint starting tomorrow was started today")
	}
	// A second sweep must not start the second sprint while the first is active.
	sweepSprints(env.app, env.now.AddDate(0, 0, 1))
	if reloadSprint(t, env.app, tomorrow.Id).GetString("state") != sprintPlanned {
		t.Fatal("a second sprint was started beside the active one")
	}
}

func TestSprintSweep_DoesNothingUnlessAsked(t *testing.T) {
	env := setupSweepEnv(t, false, false, "next")
	due := datedSprint(t, env, "Today", "a0", "2026-09-04 00:00:00.000Z", "2026-09-17 00:00:00.000Z")
	sweepSprints(env.app, env.now)
	if reloadSprint(t, env.app, due.Id).GetString("state") != sprintPlanned {
		t.Fatal("auto-start ran on a board that did not ask for it")
	}
}

func TestSprintSweep_AutoCompletesTheDayAfterTheEnd(t *testing.T) {
	env := setupSweepEnv(t, false, true, "next")
	sprint := datedSprint(t, env, "Ending", "a0", "2026-08-21 00:00:00.000Z", "2026-09-03 00:00:00.000Z")
	open := sprintCard(t, env.cardsEnv, sprint, env.list, "open", "a1", 2)
	if err := startSprint(env.app, reloadSprint(t, env.app, sprint.Id), env.now.AddDate(0, 0, -14), sprintStartOptions{}); err != nil {
		t.Fatal(err)
	}
	next := cardsSprint(t, env.app, env.project, "Next", "a1")

	// On the end day itself: still active.
	sweepSprints(env.app, time.Date(2026, 9, 3, 23, 0, 0, 0, time.UTC))
	if reloadSprint(t, env.app, sprint.Id).GetString("state") != sprintActive {
		t.Fatal("completed on its own end day")
	}
	// The day after: completed, unfinished rolled to the next planned sprint.
	sweepSprints(env.app, env.now)
	if reloadSprint(t, env.app, sprint.Id).GetString("state") != sprintCompleted {
		t.Fatal("not completed the day after its end")
	}
	requireCardSprint(open.Id, next.Id)(t, env.app)
}

func TestSprintSweep_AutoCompleteCreatesTheNextSprintWhenNoneIsPlanned(t *testing.T) {
	env := setupSweepEnv(t, false, true, "next")
	sprint := datedSprint(t, env, "Ending", "a0", "2026-08-21 00:00:00.000Z", "2026-09-03 00:00:00.000Z")
	open := sprintCard(t, env.cardsEnv, sprint, env.list, "open", "a1", 2)
	if err := startSprint(env.app, reloadSprint(t, env.app, sprint.Id), env.now.AddDate(0, 0, -14), sprintStartOptions{}); err != nil {
		t.Fatal(err)
	}

	sweepSprints(env.app, env.now)

	moved, _ := env.app.FindRecordById("boards_cards", open.Id)
	target := moved.GetString("sprint")
	if target == "" || target == sprint.Id {
		t.Fatalf("card sprint = %q, want a freshly planned sprint", target)
	}
	if reloadSprint(t, env.app, target).GetString("state") != sprintPlanned {
		t.Fatal("the created sprint is not planned")
	}
}

func TestSprintSweep_AutoCompleteToTheBacklog(t *testing.T) {
	env := setupSweepEnv(t, false, true, "backlog")
	sprint := datedSprint(t, env, "Ending", "a0", "2026-08-21 00:00:00.000Z", "2026-09-03 00:00:00.000Z")
	open := sprintCard(t, env.cardsEnv, sprint, env.list, "open", "a1", 2)
	if err := startSprint(env.app, reloadSprint(t, env.app, sprint.Id), env.now.AddDate(0, 0, -14), sprintStartOptions{}); err != nil {
		t.Fatal(err)
	}
	sweepSprints(env.app, env.now)
	requireCardSprint(open.Id, "")(t, env.app)
}

// Auto-complete then auto-start in one pass: a sprint ending yesterday and
// the next one starting today hand over without a gap.
func TestSprintSweep_HandsOverInOnePass(t *testing.T) {
	env := setupSweepEnv(t, true, true, "next")
	ending := datedSprint(t, env, "Ending", "a0", "2026-08-21 00:00:00.000Z", "2026-09-03 00:00:00.000Z")
	if err := startSprint(env.app, reloadSprint(t, env.app, ending.Id), env.now.AddDate(0, 0, -14), sprintStartOptions{}); err != nil {
		t.Fatal(err)
	}
	next := datedSprint(t, env, "Next", "a1", "2026-09-04 00:00:00.000Z", "2026-09-17 00:00:00.000Z")

	sweepSprints(env.app, env.now)

	if reloadSprint(t, env.app, ending.Id).GetString("state") != sprintCompleted {
		t.Fatal("the ending sprint did not complete")
	}
	if reloadSprint(t, env.app, next.Id).GetString("state") != sprintActive {
		t.Fatal("the next sprint did not start in the same pass")
	}
}

func TestSprintSweep_IgnoresBoardsWithoutSprints(t *testing.T) {
	env := setupSweepEnv(t, true, true, "next")
	env.project.Set("sprints_enabled", false)
	if err := env.app.Save(env.project); err != nil {
		t.Fatal(err)
	}
	due := datedSprint(t, env, "Today", "a0", "2026-09-04 00:00:00.000Z", "2026-09-17 00:00:00.000Z")
	sweepSprints(env.app, env.now)
	if reloadSprint(t, env.app, due.Id).GetString("state") != sprintPlanned {
		t.Fatal("the sweep touched a board whose sprints are off")
	}
}
