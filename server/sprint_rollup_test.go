package boards

import (
	"sync"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// The sprint rollup: a count and a raw points sum, each with a done half.

// sprintCard makes a card in `list`, in `sprint`, sized `estimate`.
func sprintCard(t *testing.T, env *cardsEnv, sprint, list *core.Record, title, rank string, estimate int) *core.Record {
	t.Helper()
	card := cardsCard(t, env.app, env.project, list, title, rank, env.owner)
	card.Set("sprint", sprint.Id)
	if estimate > 0 {
		card.Set("estimate", estimate)
	}
	if err := env.app.Save(card); err != nil {
		t.Fatalf("file %s: %v", title, err)
	}
	return card
}

func sprintNumbers(t *testing.T, env *cardsEnv, sprintID string) sprintTotals {
	t.Helper()
	sprint, err := env.app.FindRecordById("boards_sprints", sprintID)
	if err != nil {
		t.Fatalf("reload sprint: %v", err)
	}
	return sprintTotals{
		cards:      sprint.GetInt("card_total"),
		done:       sprint.GetInt("card_done"),
		points:     sprint.GetInt("points_total"),
		donePoints: sprint.GetInt("points_done"),
	}
}

func sprintDoneList(t *testing.T, env *cardsEnv) *core.Record {
	t.Helper()
	list := cardsList(t, env.app, env.project, "Done", "a5")
	list.Set("category", "done")
	if err := env.app.Save(list); err != nil {
		t.Fatalf("mark list done: %v", err)
	}
	return list
}

// Raw points: an unestimated card counts once and adds nothing — the
// divergence from the epic rollup's 1-point floor.
func TestSprintRollup_CountsCardsAndSumsRawPoints(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	sprintCard(t, env, sprint, env.list, "sized", "a1", 3)
	sprintCard(t, env, sprint, env.list, "unsized", "a2", 0)

	if got := sprintNumbers(t, env, sprint.Id); got != (sprintTotals{cards: 2, points: 3}) {
		t.Fatalf("totals = %+v, want 2 cards / 3 points", got)
	}
}

func TestSprintRollup_DoneCountsAClosedList(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	done := sprintDoneList(t, env)
	sprintCard(t, env, sprint, env.list, "open", "a1", 2)
	sprintCard(t, env, sprint, done, "finished", "a2", 5)

	if got := sprintNumbers(t, env, sprint.Id); got != (sprintTotals{cards: 2, done: 1, points: 7, donePoints: 5}) {
		t.Fatalf("totals = %+v", got)
	}
}

func TestSprintRollup_ArchivedCardsAreExcluded(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	card := sprintCard(t, env, sprint, env.list, "gone", "a1", 4)
	sprintCard(t, env, sprint, env.list, "stays", "a2", 1)

	editCard(t, env, card.Id, func(c *core.Record) { c.Set("archived", true) })

	if got := sprintNumbers(t, env, sprint.Id); got != (sprintTotals{cards: 1, points: 1}) {
		t.Fatalf("totals = %+v, want the archived card gone", got)
	}
}

func TestSprintRollup_RefilingRecountsBothSprints(t *testing.T) {
	env := setupSprintEnv(t)
	one := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	two := cardsSprint(t, env.app, env.project, "Sprint two", "a1")
	card := sprintCard(t, env, one, env.list, "moving", "a1", 3)

	editCard(t, env, card.Id, func(c *core.Record) { c.Set("sprint", two.Id) })

	if got := sprintNumbers(t, env, one.Id); got != (sprintTotals{}) {
		t.Fatalf("sprint one = %+v, want empty", got)
	}
	if got := sprintNumbers(t, env, two.Id); got != (sprintTotals{cards: 1, points: 3}) {
		t.Fatalf("sprint two = %+v", got)
	}
}

// An estimate edit and a move into a done list both change the numbers
// without the sprint changing; the two-recount update hook covers them.
func TestSprintRollup_FollowsEstimateAndListChanges(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	done := sprintDoneList(t, env)
	card := sprintCard(t, env, sprint, env.list, "growing", "a1", 1)

	editCard(t, env, card.Id, func(c *core.Record) { c.Set("estimate", 8) })
	if got := sprintNumbers(t, env, sprint.Id); got.points != 8 {
		t.Fatalf("points after estimate edit = %d, want 8", got.points)
	}
	editCard(t, env, card.Id, func(c *core.Record) { c.Set("list", done.Id) })
	if got := sprintNumbers(t, env, sprint.Id); got != (sprintTotals{cards: 1, done: 1, points: 8, donePoints: 8}) {
		t.Fatalf("totals after move to done = %+v", got)
	}
}

func TestSprintRollup_DeletingACardRecounts(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	card := sprintCard(t, env, sprint, env.list, "doomed", "a1", 3)

	if err := env.app.Delete(card); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if got := sprintNumbers(t, env, sprint.Id); got != (sprintTotals{}) {
		t.Fatalf("totals after delete = %+v, want empty", got)
	}
}

// counters_race_test.go's shape: twelve parallel files, every one counted.
func TestSprintRollup_ConcurrentFilesAreAllCounted(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")

	const n = 12
	cards := make([]*core.Record, n)
	for i := range cards {
		cards[i] = cardsCard(t, env.app, env.project, env.list, "c", "b"+string(rune('a'+i)), env.owner)
	}

	start := make(chan struct{})
	var wg sync.WaitGroup
	errs := make([]error, n)
	for i, card := range cards {
		wg.Add(1)
		go func(i int, card *core.Record) {
			defer wg.Done()
			<-start
			fresh, err := env.app.FindRecordById("boards_cards", card.Id)
			if err != nil {
				errs[i] = err
				return
			}
			fresh.Set("sprint", sprint.Id)
			fresh.Set("estimate", 2)
			errs[i] = env.app.Save(fresh)
		}(i, card)
	}
	close(start)
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("file %d: %v", i, err)
		}
	}

	if got := sprintNumbers(t, env, sprint.Id); got != (sprintTotals{cards: n, points: 2 * n}) {
		t.Fatalf("totals = %+v, want %d cards / %d points", got, n, 2*n)
	}
}

// Filing and leaving write ONE history row each, the parent/epic shape.
func TestSprintRollup_FilingWritesHistory(t *testing.T) {
	env := setupSprintEnv(t)
	registerCardActivity(env.app)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")

	editCard(t, env, env.card.Id, func(c *core.Record) { c.Set("sprint", sprint.Id) })
	editCard(t, env, env.card.Id, func(c *core.Record) { c.Set("sprint", "") })

	rows, err := env.app.FindRecordsByFilter("boards_activity",
		"card = {:card} && kind = 'sprint'", "created", 0, 0, dbx.Params{"card": env.card.Id})
	if err != nil {
		t.Fatalf("read history: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("sprint history rows = %d, want 2", len(rows))
	}
	if rows[0].GetString("to") != sprint.Id || rows[0].GetString("from") != "" {
		t.Fatalf("first row = %q → %q, want joining", rows[0].GetString("from"), rows[0].GetString("to"))
	}
	if rows[1].GetString("from") != sprint.Id || rows[1].GetString("to") != "" {
		t.Fatalf("second row = %q → %q, want leaving", rows[1].GetString("from"), rows[1].GetString("to"))
	}
}

// The epic branch that was missing: an ordinary re-file now writes history.
func TestEpicRollup_FilingWritesHistory(t *testing.T) {
	env := setupSprintEnv(t)
	registerCardActivity(env.app)
	epic := cardsEpic(t, env.app, env.project, "Authentication", "a0")

	editCard(t, env, env.card.Id, func(c *core.Record) { c.Set("epic", epic.Id) })

	n, err := env.app.CountRecords("boards_activity", dbx.HashExp{"card": env.card.Id, "kind": "epic"})
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("epic history rows = %d, want 1", n)
	}
}
