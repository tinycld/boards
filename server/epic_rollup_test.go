package boards

import (
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// The epic points rollup.
//
// Points, not counts, with an unestimated card worth 1 — the convention
// 1980000017 argues for and lib/estimate.ts mirrors on the client. "Done" is
// the LIST's status category, so an epic's progress agrees with the list
// header glyph.

// epicEnv gives the rollup hooks a live registration, so these exercise the
// same path production takes rather than calling recountEpic by hand.
func setupEpicEnv(t *testing.T) *cardsEnv {
	t.Helper()
	env := setupCardsEnv(t)
	registerEpicRollup(env.app)
	return env
}

// fileCard makes a card in `list`, filed under `epic`, sized `estimate`
// (0 = unestimated).
func fileCard(t *testing.T, env *cardsEnv, epic, list *core.Record, title, rank string, estimate int) *core.Record {
	t.Helper()
	card := cardsCard(t, env.app, env.project, list, title, rank, env.owner)
	card.Set("epic", epic.Id)
	if estimate > 0 {
		card.Set("estimate", estimate)
	}
	if err := env.app.Save(card); err != nil {
		t.Fatalf("file %s: %v", title, err)
	}
	return card
}

// refile saves `epic` on a card through the model hooks. Fresh-loads the row
// first: Save() does not refresh originalData in place, and the rollup reads
// Original() to find the epic a card is leaving. setParent's note, same trap.
func refile(t *testing.T, env *cardsEnv, cardID, epicID string) {
	t.Helper()
	card, err := env.app.FindRecordById("boards_cards", cardID)
	if err != nil {
		t.Fatalf("load card: %v", err)
	}
	card.Set("epic", epicID)
	if err := env.app.Save(card); err != nil {
		t.Fatalf("refile: %v", err)
	}
}

// editCard applies one change through the model hooks, fresh-loading for the
// same reason refile does.
func editCard(t *testing.T, env *cardsEnv, cardID string, apply func(*core.Record)) {
	t.Helper()
	card, err := env.app.FindRecordById("boards_cards", cardID)
	if err != nil {
		t.Fatalf("load card: %v", err)
	}
	apply(card)
	if err := env.app.Save(card); err != nil {
		t.Fatalf("save card: %v", err)
	}
}

func epicPoints(t *testing.T, env *cardsEnv, epicID string) (total, done int) {
	t.Helper()
	epic, err := env.app.FindRecordById("boards_epics", epicID)
	if err != nil {
		t.Fatalf("reload epic: %v", err)
	}
	return epic.GetInt("points_total"), epic.GetInt("points_done")
}

// The floor is the whole reason this is points rather than counts: a board
// that never estimates must still get a meaningful number.
func TestEpicRollup_UnestimatedCardsCountAsOnePoint(t *testing.T) {
	env := setupEpicEnv(t)
	epic := cardsEpic(t, env.app, env.project, "Auth", "a0")

	fileCard(t, env, epic, env.list, "unsized", "a1", 0)
	fileCard(t, env, epic, env.list, "unsized too", "a2", 0)

	total, done := epicPoints(t, env, epic.Id)
	if total != 2 || done != 0 {
		t.Fatalf("points = %d/%d, want 2/0 — two unestimated cards are 1 point each", done, total)
	}
}

func TestEpicRollup_SumsEstimatesWithTheFloor(t *testing.T) {
	env := setupEpicEnv(t)
	epic := cardsEpic(t, env.app, env.project, "Auth", "a0")

	fileCard(t, env, epic, env.list, "big", "a1", 8)
	fileCard(t, env, epic, env.list, "small", "a2", 3)
	fileCard(t, env, epic, env.list, "unsized", "a3", 0)

	total, _ := epicPoints(t, env, epic.Id)
	if total != 12 {
		t.Fatalf("points_total = %d, want 12 (8 + 3 + 1)", total)
	}
}

// "Done" is the list's category, reusing 1980000011's vocabulary, so the epic
// agrees with the list header glyph.
func TestEpicRollup_DoneCountsAClosedList(t *testing.T) {
	env := setupEpicEnv(t)
	epic := cardsEpic(t, env.app, env.project, "Auth", "a0")

	done := cardsList(t, env.app, env.project, "Done", "z0")
	done.Set("category", "done")
	if err := env.app.Save(done); err != nil {
		t.Fatal(err)
	}
	canceled := cardsList(t, env.app, env.project, "Won't do", "z1")
	canceled.Set("category", "canceled")
	if err := env.app.Save(canceled); err != nil {
		t.Fatal(err)
	}

	fileCard(t, env, epic, env.list, "open", "a1", 5)
	fileCard(t, env, epic, done, "shipped", "a2", 3)
	fileCard(t, env, epic, canceled, "dropped", "a3", 2)

	total, donePoints := epicPoints(t, env, epic.Id)
	// Canceled is closed too: work that stopped, either way.
	if total != 10 || donePoints != 5 {
		t.Fatalf("points = %d/%d, want 5/10", donePoints, total)
	}
}

// An archived card is off the board. Counting it would leave an epic that can
// never reach 100%.
func TestEpicRollup_ArchivedCardsAreExcluded(t *testing.T) {
	env := setupEpicEnv(t)
	epic := cardsEpic(t, env.app, env.project, "Auth", "a0")

	fileCard(t, env, epic, env.list, "live", "a1", 5)
	shelved := fileCard(t, env, epic, env.list, "shelved", "a2", 8)
	editCard(t, env, shelved.Id, func(c *core.Record) { c.Set("archived", true) })

	total, _ := epicPoints(t, env, epic.Id)
	if total != 5 {
		t.Fatalf("points_total = %d, want 5 — an archived card is off the board", total)
	}
}

// The re-file case: both epics must be recounted, and the old id survives only
// on Original().
func TestEpicRollup_RefilingRecountsBothEpics(t *testing.T) {
	env := setupEpicEnv(t)
	from := cardsEpic(t, env.app, env.project, "From", "a0")
	to := cardsEpic(t, env.app, env.project, "To", "a1")

	card := fileCard(t, env, from, env.list, "moves", "a1", 5)
	if total, _ := epicPoints(t, env, from.Id); total != 5 {
		t.Fatalf("precondition: from = %d, want 5", total)
	}

	refile(t, env, card.Id, to.Id)

	if total, _ := epicPoints(t, env, from.Id); total != 0 {
		t.Errorf("the epic it LEFT = %d, want 0", total)
	}
	if total, _ := epicPoints(t, env, to.Id); total != 5 {
		t.Errorf("the epic it JOINED = %d, want 5", total)
	}
}

// A total moves without the epic changing at all: an estimate edit, and a move
// into a done list.
func TestEpicRollup_FollowsEstimateAndListChanges(t *testing.T) {
	env := setupEpicEnv(t)
	epic := cardsEpic(t, env.app, env.project, "Auth", "a0")
	card := fileCard(t, env, epic, env.list, "resized", "a1", 3)

	editCard(t, env, card.Id, func(c *core.Record) { c.Set("estimate", 13) })
	if total, _ := epicPoints(t, env, epic.Id); total != 13 {
		t.Errorf("after resize points_total = %d, want 13", total)
	}

	done := cardsList(t, env.app, env.project, "Done", "z0")
	done.Set("category", "done")
	if err := env.app.Save(done); err != nil {
		t.Fatal(err)
	}
	editCard(t, env, card.Id, func(c *core.Record) { c.Set("list", done.Id) })
	if total, donePoints := epicPoints(t, env, epic.Id); donePoints != 13 || total != 13 {
		t.Errorf("after completion points = %d/%d, want 13/13", donePoints, total)
	}
}

func TestEpicRollup_DeletingACardRecountsItsEpic(t *testing.T) {
	env := setupEpicEnv(t)
	epic := cardsEpic(t, env.app, env.project, "Auth", "a0")
	fileCard(t, env, epic, env.list, "stays", "a1", 3)
	going := fileCard(t, env, epic, env.list, "goes", "a2", 5)

	fresh, err := env.app.FindRecordById("boards_cards", going.Id)
	if err != nil {
		t.Fatal(err)
	}
	if err := env.app.Delete(fresh); err != nil {
		t.Fatal(err)
	}
	if total, _ := epicPoints(t, env, epic.Id); total != 3 {
		t.Fatalf("points_total = %d, want 3 after the delete", total)
	}
}

// The lock counters.go shipped without. A bulk re-file writes many cards at
// once; without serialization the recounts lose updates.
//
// Twelve cards released from a common gate, for the reason
// TestRecountCard_ConcurrentInsertsAreAllCounted gives: the window is narrow,
// and a two-card version reproduces only intermittently.
func TestEpicRollup_ConcurrentFilesAreAllCounted(t *testing.T) {
	env := setupEpicEnv(t)
	epic := cardsEpic(t, env.app, env.project, "Auth", "a0")

	// Everything except the contended Save happens BEFORE the gate opens, so
	// the only thing racing is the write whose recount is under test. Staging
	// work inside the goroutines lets them desynchronize across it and buries
	// the race: creating the card there reproduced on roughly 1 run in 25, and
	// fresh-loading there on 3 in 10.
	//
	// EVEN STAGED THIS WAY THE FAILURE IS PROBABILISTIC — about 2 runs in 10
	// without the lock, never with it. PocketBase routes writes through the
	// NON-concurrent (single-connection) builder, so the writes themselves are
	// already partly serialized and the recount windows only sometimes
	// overlap. This test therefore proves the lock matters; it cannot prove
	// its absence on any single run, and `-count` is what makes it a usable
	// guard. The lock's correctness rests on the code being a plain
	// read-modify-write, which counters.go already shipped the bug for.
	//
	// Loading before the Set is required for a separate reason: Save() does
	// not refresh originalData in place, so a record must be read fresh for
	// Original() to hold the epic it is leaving (refile's note).
	const cards = 12
	staged := make([]*core.Record, cards)
	for i := range cards {
		id := cardsCard(
			t, env.app, env.project, env.list, "bulk", string(rune('a'+i)), env.owner,
		).Id
		editCard(t, env, id, func(c *core.Record) { c.Set("estimate", 2) })
		loaded, err := env.app.FindRecordById("boards_cards", id)
		if err != nil {
			t.Fatal(err)
		}
		loaded.Set("epic", epic.Id)
		staged[i] = loaded
	}

	var wg sync.WaitGroup
	start := make(chan struct{})
	for _, card := range staged {
		wg.Add(1)
		go func(c *core.Record) {
			defer wg.Done()
			<-start
			if err := env.app.Save(c); err != nil {
				t.Errorf("save: %v", err)
			}
		}(card)
	}
	close(start)
	wg.Wait()

	total, _ := epicPoints(t, env, epic.Id)
	if total != cards*2 {
		t.Fatalf("points_total = %d, want %d — a concurrent file was lost", total, cards*2)
	}
}
