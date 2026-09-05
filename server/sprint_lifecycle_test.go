package boards

import (
	"errors"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// The two transitions, driven as the endpoints and the sweep drive them.
// The activity hook is bound so the rolled cards' history is proven to be
// ONE attributed row each — the endpoint marks the saves as owning their
// relation history, and without that the after-success diff writes a
// second, unattributed copy.

type lifecycleEnv struct {
	*cardsEnv
	done *core.Record
	now  time.Time
}

func setupLifecycleEnv(t *testing.T) *lifecycleEnv {
	t.Helper()
	env := setupSprintEnv(t)
	registerActorCapture(env.app)
	registerCardActivity(env.app)
	done := sprintDoneList(t, env)
	return &lifecycleEnv{
		cardsEnv: env,
		done:     done,
		now:      time.Date(2026, 9, 4, 15, 30, 0, 0, time.UTC),
	}
}

func reloadSprint(t *testing.T, app core.App, id string) *core.Record {
	t.Helper()
	sprint, err := app.FindRecordById("boards_sprints", id)
	if err != nil {
		t.Fatalf("reload sprint: %v", err)
	}
	return sprint
}

func snapshotCount(t *testing.T, app core.App, sprintID string) int {
	t.Helper()
	n, err := app.CountRecords("boards_sprint_snapshots", dbx.HashExp{"sprint": sprintID})
	if err != nil {
		t.Fatal(err)
	}
	return int(n)
}

func TestStartSprint_StampsTheCommitmentAndDatesIt(t *testing.T) {
	env := setupLifecycleEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	sprintCard(t, env.cardsEnv, sprint, env.list, "sized", "a1", 3)
	sprintCard(t, env.cardsEnv, sprint, env.list, "unsized", "a2", 0)

	if err := startSprint(env.app, sprint, env.now, sprintStartOptions{}); err != nil {
		t.Fatalf("start: %v", err)
	}

	got := reloadSprint(t, env.app, sprint.Id)
	if got.GetString("state") != sprintActive {
		t.Fatalf("state = %q, want active", got.GetString("state"))
	}
	if got.GetInt("committed_count") != 2 || got.GetInt("committed_points") != 3 {
		t.Fatalf("commitment = %d cards / %d pts, want 2 / 3",
			got.GetInt("committed_count"), got.GetInt("committed_points"))
	}
	if got.GetDateTime("started_at").IsZero() {
		t.Fatal("started_at was not stamped")
	}
	// Undated: today for the board's default length, inclusive.
	if start := got.GetString("start"); start[:10] != "2026-09-04" {
		t.Fatalf("start = %q, want today", start)
	}
	if end := got.GetString("end"); end[:10] != "2026-09-17" {
		t.Fatalf("end = %q, want today + 13", end)
	}
	if n := snapshotCount(t, env.app, sprint.Id); n != 1 {
		t.Fatalf("snapshots = %d, want the opening point", n)
	}
}

func TestStartSprint_HonoursTheBoardsLengthAndGivenDates(t *testing.T) {
	env := setupLifecycleEnv(t)
	env.project.Set("sprint_length_days", 7)
	if err := env.app.Save(env.project); err != nil {
		t.Fatal(err)
	}
	sprint := cardsSprint(t, env.app, env.project, "", "a0")

	if err := startSprint(env.app, sprint, env.now, sprintStartOptions{Start: "2026-09-07", Name: "Polish"}); err != nil {
		t.Fatalf("start: %v", err)
	}
	got := reloadSprint(t, env.app, sprint.Id)
	if got.GetString("end")[:10] != "2026-09-13" {
		t.Fatalf("end = %q, want the start + 6", got.GetString("end"))
	}
	if got.GetString("name") != "Polish" {
		t.Fatalf("name = %q", got.GetString("name"))
	}
}

func TestStartSprint_RefusesAnythingButPlanned(t *testing.T) {
	env := setupLifecycleEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	if err := startSprint(env.app, sprint, env.now, sprintStartOptions{}); err != nil {
		t.Fatal(err)
	}
	again := reloadSprint(t, env.app, sprint.Id)
	if err := startSprint(env.app, again, env.now, sprintStartOptions{}); err == nil {
		t.Fatal("an active sprint started again")
	}
}

// seedActive plans a sprint, files cards in it, and starts it.
func seedActive(t *testing.T, env *lifecycleEnv) (sprint, finished, open1, open2 *core.Record) {
	t.Helper()
	sprint = cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	finished = sprintCard(t, env.cardsEnv, sprint, env.done, "finished", "a1", 5)
	open1 = sprintCard(t, env.cardsEnv, sprint, env.list, "open one", "a2", 2)
	open2 = sprintCard(t, env.cardsEnv, sprint, env.list, "open two", "a3", 0)
	if err := startSprint(env.app, sprint, env.now, sprintStartOptions{}); err != nil {
		t.Fatalf("start: %v", err)
	}
	return reloadSprint(t, env.app, sprint.Id), finished, open1, open2
}

func TestCompleteSprint_RefusesWithoutARolloverAnswer(t *testing.T) {
	env := setupLifecycleEnv(t)
	sprint, _, _, _ := seedActive(t, env)

	_, err := completeSprint(env.app, sprint, env.now, env.owner.Id, sprintRollover{})
	if !errors.Is(err, errRolloverRequired) {
		t.Fatalf("err = %v, want errRolloverRequired", err)
	}
	if reloadSprint(t, env.app, sprint.Id).GetString("state") != sprintActive {
		t.Fatal("the refusal changed the sprint")
	}
}

func TestCompleteSprint_RollsUnfinishedToTheNextSprint(t *testing.T) {
	env := setupLifecycleEnv(t)
	sprint, finished, open1, open2 := seedActive(t, env)
	next := cardsSprint(t, env.app, env.project, "Sprint two", "a1")

	result, err := completeSprint(env.app, sprint, env.now.AddDate(0, 0, 14), env.owner.Id,
		sprintRollover{Target: rolloverNext, SprintID: next.Id})
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if result.CompletedCount != 1 || result.CompletedPoints != 5 || result.RolledCount != 2 || result.TargetSprintID != next.Id {
		t.Fatalf("result = %+v", result)
	}

	got := reloadSprint(t, env.app, sprint.Id)
	if got.GetString("state") != sprintCompleted || got.GetDateTime("completed_at").IsZero() {
		t.Fatalf("sprint = %q / completed_at %q", got.GetString("state"), got.GetString("completed_at"))
	}
	if got.GetInt("completed_count") != 1 || got.GetInt("completed_points") != 5 || got.GetInt("rolled_count") != 2 {
		t.Fatalf("stamps = %d / %d / %d", got.GetInt("completed_count"), got.GetInt("completed_points"), got.GetInt("rolled_count"))
	}
	for _, card := range []*core.Record{open1, open2} {
		requireCardSprint(card.Id, next.Id)(t, env.app)
	}
	// The finished card stays in the sprint it finished in.
	requireCardSprint(finished.Id, sprint.Id)(t, env.app)

	// Exactly one attributed history row per rolled card.
	for _, card := range []*core.Record{open1, open2} {
		rows, err := env.app.FindRecordsByFilter("boards_activity",
			"card = {:card} && kind = 'sprint' && from = {:from}", "", 0, 0,
			dbx.Params{"card": card.Id, "from": sprint.Id})
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 1 {
			t.Fatalf("card %s: %d rollover rows, want exactly 1", card.GetString("title"), len(rows))
		}
		if rows[0].GetString("actor") != env.owner.Id || rows[0].GetString("to") != next.Id {
			t.Fatalf("row = actor %q → %q", rows[0].GetString("actor"), rows[0].GetString("to"))
		}
	}
	// Opening point at start, closing point at completion.
	if n := snapshotCount(t, env.app, sprint.Id); n != 2 {
		t.Fatalf("snapshots = %d, want 2", n)
	}
}

func TestCompleteSprint_NewPlansTheFollowingSprint(t *testing.T) {
	env := setupLifecycleEnv(t)
	sprint, _, open1, _ := seedActive(t, env)

	result, err := completeSprint(env.app, sprint, env.now, "", sprintRollover{Target: rolloverNew})
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if !result.CreatedSprint || result.TargetSprintID == "" {
		t.Fatalf("result = %+v, want a created target", result)
	}
	created := reloadSprint(t, env.app, result.TargetSprintID)
	if created.GetString("state") != sprintPlanned || created.GetInt("number") != 2 {
		t.Fatalf("created = %q #%d, want planned #2", created.GetString("state"), created.GetInt("number"))
	}
	// Dated from the day after the completed sprint ends, for the board's length.
	if created.GetString("start")[:10] != "2026-09-18" || created.GetString("end")[:10] != "2026-10-01" {
		t.Fatalf("created dates = %s → %s", created.GetString("start"), created.GetString("end"))
	}
	requireCardSprint(open1.Id, created.Id)(t, env.app)
}

func TestCompleteSprint_BacklogUnfilesTheUnfinished(t *testing.T) {
	env := setupLifecycleEnv(t)
	sprint, finished, open1, open2 := seedActive(t, env)

	result, err := completeSprint(env.app, sprint, env.now, env.owner.Id, sprintRollover{Target: rolloverBacklog})
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if result.TargetSprintID != "" || result.RolledCount != 2 {
		t.Fatalf("result = %+v", result)
	}
	requireCardSprint(open1.Id, "")(t, env.app)
	requireCardSprint(open2.Id, "")(t, env.app)
	requireCardSprint(finished.Id, sprint.Id)(t, env.app)
}

func TestCompleteSprint_NothingUnfinishedNeedsNoAnswer(t *testing.T) {
	env := setupLifecycleEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	sprintCard(t, env.cardsEnv, sprint, env.done, "finished", "a1", 1)
	if err := startSprint(env.app, sprint, env.now, sprintStartOptions{}); err != nil {
		t.Fatal(err)
	}
	result, err := completeSprint(env.app, reloadSprint(t, env.app, sprint.Id), env.now, env.owner.Id, sprintRollover{})
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if result.RolledCount != 0 || result.CompletedCount != 1 {
		t.Fatalf("result = %+v", result)
	}
}

// An archived card is neither finished nor outstanding: it is not rolled, and
// it is not counted as done.
func TestCompleteSprint_ArchivedCardsAreLeftAlone(t *testing.T) {
	env := setupLifecycleEnv(t)
	sprint, _, open1, _ := seedActive(t, env)
	editCard(t, env.cardsEnv, open1.Id, func(c *core.Record) { c.Set("archived", true) })

	result, err := completeSprint(env.app, reloadSprint(t, env.app, sprint.Id), env.now, env.owner.Id,
		sprintRollover{Target: rolloverBacklog})
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if result.RolledCount != 1 {
		t.Fatalf("rolled = %d, want 1 (the archived card stays put)", result.RolledCount)
	}
	requireCardSprint(open1.Id, sprint.Id)(t, env.app)
}
