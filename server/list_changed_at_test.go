package boards

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tools/types"
)

// boards_cards.list_changed_at — the server-owned clock the auto-archive sweep
// counts from. These bind registerListChangedAt itself, the
// card_archived_test.go shape.

func TestListChangedAt_StampedOnCreateAndOnEveryMove(t *testing.T) {
	env := setupCardsEnv(t)
	registerListChangedAt(env.app)
	todo := cardsList(t, env.app, env.project, "To do", "a8")
	done := cardsList(t, env.app, env.project, "Done", "a9")

	card := cardsCard(t, env.app, env.project, todo, "fresh", "z0", env.owner)
	// Re-read: the in-memory stamp carries nanoseconds, the stored one
	// milliseconds, and the comparisons below are against what is stored.
	stored, err := env.app.FindRecordById("boards_cards", card.Id)
	if err != nil {
		t.Fatal(err)
	}
	created := stored.GetDateTime("list_changed_at")
	if created.IsZero() {
		t.Fatalf("list_changed_at zero after create")
	}

	// A move re-stamps; the old value is what the sweep would have counted from.
	backdated := types.NowDateTime().Add(-48 * time.Hour)
	fresh, err := env.app.FindRecordById("boards_cards", card.Id)
	if err != nil {
		t.Fatal(err)
	}
	fresh.Set("list_changed_at", backdated)
	fresh.Set("title", "renamed")
	if err := env.app.Save(fresh); err != nil {
		t.Fatal(err)
	}
	if got := fresh.GetDateTime("list_changed_at"); got.String() != created.String() {
		t.Fatalf("a title edit changed list_changed_at to %v, want %v kept (forged clock survived)", got, created)
	}

	fresh, err = env.app.FindRecordById("boards_cards", card.Id)
	if err != nil {
		t.Fatal(err)
	}
	fresh.Set("list", done.Id)
	if err := env.app.Save(fresh); err != nil {
		t.Fatal(err)
	}
	moved := fresh.GetDateTime("list_changed_at")
	if moved.Before(created) {
		t.Fatalf("list_changed_at = %v after a move, want at or after %v", moved, created)
	}
	if since := time.Since(moved.Time()); since < 0 || since > time.Minute {
		t.Errorf("list_changed_at = %v after a move, want approximately now", moved)
	}
}

func TestListChangedAt_ClientCannotErase(t *testing.T) {
	env := setupCardsEnv(t)
	registerListChangedAt(env.app)
	todo := cardsList(t, env.app, env.project, "To do", "a8")

	card := cardsCard(t, env.app, env.project, todo, "fresh", "z0", env.owner)
	fresh, err := env.app.FindRecordById("boards_cards", card.Id)
	if err != nil {
		t.Fatal(err)
	}
	fresh.Set("list_changed_at", "")
	fresh.Set("title", "renamed")
	if err := env.app.Save(fresh); err != nil {
		t.Fatal(err)
	}
	if fresh.GetDateTime("list_changed_at").IsZero() {
		t.Fatalf("a client erased list_changed_at")
	}
}
