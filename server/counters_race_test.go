package boards

import (
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// Two checklist items created at the SAME MOMENT must both be counted.
//
// recountCard reads the card, COUNT(*)s the children and writes the total
// back. That is a read-modify-write with no serialization, so two concurrent
// inserts can both take a count before the other's row is visible and both
// write the same stale total — a lost update. "Recompute, never delta"
// prevents drift over time; it does not make one recompute atomic.
//
// This is the duplicate-card path in production: useDuplicateCard yields its
// checklist inserts as an ARRAY, which runs them in parallel, so a two-item
// copy lands two creates at once and the face reads "0/1". It does not
// self-heal — the counter is only recomputed by the next child write.
//
// Twelve items rather than two, and released from a common starting gate: the
// window is narrow, so a two-goroutine version reproduces only intermittently
// and would let a regression through. Verified by removing the lock, where
// this fails on essentially every run.
func TestRecountCard_ConcurrentInsertsAreAllCounted(t *testing.T) {
	env := setupCardsEnv(t)

	env.app.OnRecordAfterCreateSuccess("boards_checklist_items").BindFunc(func(e *core.RecordEvent) error {
		recountCard(e.App, e.Record.GetString("card"))
		return e.Next()
	})

	const items = 12
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := range items {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			<-start // release together, so the recounts genuinely overlap
			cardsChecklistItem(t, env.app, env.project, env.card, "item", string(rune('a'+n)))
		}(i)
	}
	close(start)
	wg.Wait()

	got := reloadCard(t, env.app, env.card.Id).GetInt("checklist_total")
	if got != items {
		t.Fatalf("checklist_total = %d, want %d — a concurrent insert was lost", got, items)
	}
}
