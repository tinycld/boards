package boards

import (
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// Per-board card numbers.
//
// counters_test.go has no equivalent of the concurrency test below, and cannot:
// its counters are RECOMPUTED from a COUNT(*), so two racing writers converge on
// the same answer by construction. This allocator hands out a value that must
// never repeat, so a race here is a duplicate key rather than a stale badge —
// which is why the allocation is a compare-and-swap and why this file leans on
// that case hardest.
//
// These call allocateNumber directly where the arithmetic is under test, then
// prove the hook wiring separately — the same split counters_test.go uses.

// bindNumbers wires the allocator onto a bare RLS app, which by design binds no
// hooks. The RLS suites measure the rule engine alone; this file measures the
// hook, so it has to opt in explicitly.
func bindNumbers(t *testing.T, env *cardsEnv) {
	t.Helper()
	env.app.OnRecordCreate("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		n, err := allocateNumber(e.App, e.Record.GetString("project"))
		if err != nil {
			return err
		}
		e.Record.Set("number", n)
		return e.Next()
	})
}

func newNumberedCard(t *testing.T, env *cardsEnv, title, position string) *core.Record {
	t.Helper()
	col, err := env.app.FindCollectionByNameOrId("boards_cards")
	if err != nil {
		t.Fatalf("find boards_cards: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("project", env.project.Id)
	r.Set("list", env.list.Id)
	r.Set("title", title)
	r.Set("position", position)
	r.Set("created_by", env.owner.Id)
	if err := env.app.Save(r); err != nil {
		t.Fatalf("save card %s: %v", title, err)
	}
	return r
}

// The race. PocketBase does not wrap a single-record REST create in a
// transaction (apis/record_crud.go -> form.Submit -> core/db.go app.create, no
// RunInTransaction on that path), so a SELECT-then-UPDATE allocator would hand
// the same number to two writers. This proves the compare-and-swap does not.
//
// SQLite serializes the writes, so what this really exercises is the CAS retry
// loop under contention — which is exactly the situation the allocator has to
// survive. A MAX(number)+1 implementation fails this test.
func TestCardsNumbers_ConcurrentAllocationsAreUnique(t *testing.T) {
	env := setupCardsEnv(t)

	const writers = 12
	var wg sync.WaitGroup
	got := make([]int, writers)
	errs := make([]error, writers)

	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			got[i], errs[i] = allocateNumber(env.app, env.project.Id)
		}(i)
	}
	wg.Wait()

	seen := map[int]bool{}
	for i, n := range got {
		if errs[i] != nil {
			t.Fatalf("writer %d: %v", i, errs[i])
		}
		if seen[n] {
			t.Fatalf("number %d was handed out twice — the allocator is not atomic", n)
		}
		seen[n] = true
	}
	if len(seen) != writers {
		t.Fatalf("got %d distinct numbers, want %d", len(seen), writers)
	}
}

// The whole reason this is a counter and not MAX(number)+1: deleting the
// highest card must NOT free its number for reuse. Two cards in a board's
// history answering to the same key is the bug this prevents.
func TestCardsNumbers_NeverReusedAfterDeletingTheHighestCard(t *testing.T) {
	env := setupCardsEnv(t)
	bindNumbers(t, env)

	first := newNumberedCard(t, env, "first", "a0")
	second := newNumberedCard(t, env, "second", "a1")

	if first.GetInt("number") != 1 || second.GetInt("number") != 2 {
		t.Fatalf("initial numbers = %d, %d; want 1, 2",
			first.GetInt("number"), second.GetInt("number"))
	}

	if err := env.app.Delete(second); err != nil {
		t.Fatalf("delete second card: %v", err)
	}

	third := newNumberedCard(t, env, "third", "a2")
	if got := third.GetInt("number"); got != 3 {
		t.Fatalf("number after deleting the highest card = %d, want 3 — a deleted number was reused", got)
	}
}

// The wiring, not the arithmetic. Without this, every other assertion in this
// file could pass while production cards got no number at all — the failure
// mode counters_test.go's CreateHookReachesTheCard exists to catch.
func TestCardsNumbers_CreateHookAssignsANumber(t *testing.T) {
	env := setupCardsEnv(t)
	bindNumbers(t, env)

	card := newNumberedCard(t, env, "hooked", "a0")

	fresh, err := env.app.FindRecordById("boards_cards", card.Id)
	if err != nil {
		t.Fatalf("re-read card: %v", err)
	}
	if got := fresh.GetInt("number"); got != 1 {
		t.Fatalf("number = %d, want 1 — the create hook did not assign one", got)
	}
}

// A number in the request body is overwritten, not honored. No rule pins this
// field (it is a scalar, not a relation), so the hook is the entire protection
// — the same exposure counters_test.go documents for comment_count.
func TestCardsNumbers_ClientSuppliedNumberIsIgnored(t *testing.T) {
	env := setupCardsEnv(t)
	bindNumbers(t, env)

	col, err := env.app.FindCollectionByNameOrId("boards_cards")
	if err != nil {
		t.Fatalf("find boards_cards: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("project", env.project.Id)
	r.Set("list", env.list.Id)
	r.Set("title", "forged")
	r.Set("position", "a0")
	r.Set("created_by", env.owner.Id)
	r.Set("number", 9999)
	if err := env.app.Save(r); err != nil {
		t.Fatalf("save card: %v", err)
	}

	if got := r.GetInt("number"); got != 1 {
		t.Fatalf("number = %d, want 1 — a client-supplied number was honored", got)
	}
}

// The invariant that separates this file from counters.go: when a number cannot
// be allocated the write FAILS, rather than being logged and shrugged off. A
// card with no key cannot be linked or cited, and nothing later would repair it.
func TestCardsNumbers_AllocationFailureRefusesTheInsert(t *testing.T) {
	env := setupCardsEnv(t)

	if _, err := allocateNumber(env.app, ""); err == nil {
		t.Fatal("allocateNumber with no project returned nil error")
	}
	if _, err := allocateNumber(env.app, "nonexistentxxxx"); err == nil {
		t.Fatal("allocateNumber for a missing project returned nil error")
	}
}

// Re-keying on a board change, and the assertion that Record.Original() is
// actually populated when the update hook runs — the one thing the design
// depends on that is not obvious from the hook signature. core/record_model.go
// fills originalData in PostScan (at DB load), so it is available here; this
// test is what would catch that changing.
func TestCardsNumbers_ProjectChangeAllocatesOnTheDestination(t *testing.T) {
	env := setupCardsEnv(t)
	bindNumbers(t, env)

	var sawOriginal string
	env.app.OnRecordUpdate("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		next := e.Record.GetString("project")
		prior := e.Record.Original().GetString("project")
		sawOriginal = prior
		if next == "" || prior == "" || next == prior {
			return e.Next()
		}
		n, err := allocateNumber(e.App, next)
		if err != nil {
			return err
		}
		e.Record.Set("number", n)
		return e.Next()
	})

	card := newNumberedCard(t, env, "mover", "a0")
	if got := card.GetInt("number"); got != 1 {
		t.Fatalf("number on the origin board = %d, want 1", got)
	}

	// A second board with its own sequence, already advanced past 1 so a stale
	// number would be visibly wrong rather than coincidentally right.
	other := cardsProject(t, env.app, "Other board", env.owner)
	cardsMember(t, env.app, other, env.owner, "owner")
	otherList := cardsList(t, env.app, other, "To do", "a0")
	for _, title := range []string{"o1", "o2"} {
		r := core.NewRecord(mustCollection(t, env.app, "boards_cards"))
		r.Set("project", other.Id)
		r.Set("list", otherList.Id)
		r.Set("title", title)
		r.Set("position", "a0")
		r.Set("created_by", env.owner.Id)
		if err := env.app.Save(r); err != nil {
			t.Fatalf("save %s: %v", title, err)
		}
	}

	// Reload before mutating, the way the API does. PB's Save does not refresh
	// originalData in place, so a record still held from test setup reports its
	// PRE-save values as Original() — see the same note on
	// coreserver/users_guard_test.go's updateAsAuthenticated. Every real update
	// path loads the record fresh first, so this is the honest simulation, not
	// a workaround.
	card, err := env.app.FindRecordById("boards_cards", card.Id)
	if err != nil {
		t.Fatalf("reload card: %v", err)
	}

	card.Set("project", other.Id)
	card.Set("list", otherList.Id)
	if err := env.app.Save(card); err != nil {
		t.Fatalf("move card: %v", err)
	}

	if sawOriginal != env.project.Id {
		t.Fatalf("Original().project = %q, want %q — the pre-write state was not available",
			sawOriginal, env.project.Id)
	}
	if got := card.GetInt("number"); got != 3 {
		t.Fatalf("number after the move = %d, want 3 — it should come from the DESTINATION board's sequence", got)
	}
}

// An update that does not change the board leaves the number alone. Without
// this, every title edit would burn a number and the sequence would race ahead
// of the card count.
func TestCardsNumbers_SameBoardUpdateKeepsTheNumber(t *testing.T) {
	env := setupCardsEnv(t)
	bindNumbers(t, env)
	registerCardNumbersUpdateOnly(t, env)

	created := newNumberedCard(t, env, "stable", "a0")
	want := created.GetInt("number")

	// Reloaded for the same reason as the move test above: Original() only
	// reflects persisted state on a freshly fetched record.
	card, err := env.app.FindRecordById("boards_cards", created.Id)
	if err != nil {
		t.Fatalf("reload card: %v", err)
	}

	card.Set("title", "renamed")
	if err := env.app.Save(card); err != nil {
		t.Fatalf("rename card: %v", err)
	}

	if got := card.GetInt("number"); got != want {
		t.Fatalf("number = %d after a rename, want %d unchanged", got, want)
	}
}

func registerCardNumbersUpdateOnly(t *testing.T, env *cardsEnv) {
	t.Helper()
	env.app.OnRecordUpdate("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		next := e.Record.GetString("project")
		prior := e.Record.Original().GetString("project")
		if next == "" || prior == "" || next == prior {
			return e.Next()
		}
		n, err := allocateNumber(e.App, next)
		if err != nil {
			return err
		}
		e.Record.Set("number", n)
		return e.Next()
	})
}

func mustCollection(t *testing.T, app core.App, name string) *core.Collection {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(name)
	if err != nil {
		t.Fatalf("find %s: %v", name, err)
	}
	return col
}
