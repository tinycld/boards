package cards

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// The board-face counters.
//
// These are NOT rule tests: the RLS suites deliberately bind no hooks, because
// they measure what a hosted tenant runs (rules alone). This file is the other
// half — it calls recountCard directly, so the arithmetic is proven without
// depending on hook wiring, and then proves the wiring separately.

func TestCardsCounters_RecountReflectsChecklistAndComments(t *testing.T) {
	env := setupCardsEnv(t)

	cardsChecklistItem(t, env.app, env.project, env.card, "one", "a0")
	done := cardsChecklistItem(t, env.app, env.project, env.card, "two", "a1")
	done.Set("is_done", true)
	if err := env.app.Save(done); err != nil {
		t.Fatalf("mark item done: %v", err)
	}
	cardsComment(t, env.app, env.project, env.card, env.editor, "hello")

	recountCard(env.app, env.card.Id)

	fresh, err := env.app.FindRecordById("cards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("re-read card: %v", err)
	}
	if got := fresh.GetInt("checklist_total"); got != 2 {
		t.Errorf("checklist_total = %d, want 2", got)
	}
	if got := fresh.GetInt("checklist_done"); got != 1 {
		t.Errorf("checklist_done = %d, want 1", got)
	}
	if got := fresh.GetInt("comment_count"); got != 1 {
		t.Errorf("comment_count = %d, want 1", got)
	}
}

// attachment_count is the fourth counter, added after the create migration
// shipped. It rides the same recount, so this proves the new field is actually
// wired into it rather than left at zero forever — which is what would happen
// if the migration landed without the countRows call.
func TestCardsCounters_RecountReflectsAttachments(t *testing.T) {
	env := setupCardsEnv(t)

	cardsAttachment(t, env.app, env.project, env.card, env.editor, "notes.txt")
	second := cardsAttachment(t, env.app, env.project, env.card, env.editor, "spec.txt")

	recountCard(env.app, env.card.Id)

	fresh, err := env.app.FindRecordById("cards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("re-read card: %v", err)
	}
	if got := fresh.GetInt("attachment_count"); got != 2 {
		t.Fatalf("attachment_count = %d, want 2", got)
	}

	if err := env.app.Delete(second); err != nil {
		t.Fatalf("delete attachment: %v", err)
	}
	recountCard(env.app, env.card.Id)

	fresh, err = env.app.FindRecordById("cards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("re-read card after delete: %v", err)
	}
	if got := fresh.GetInt("attachment_count"); got != 1 {
		t.Errorf("attachment_count = %d, want 1 after delete", got)
	}
}

// Same exposure as the comment_count case: attachment_count is not a relation,
// so no rule pins it and a member can write it directly. The recount is what
// corrects it.
func TestCardsCounters_RecountOverwritesClientSuppliedAttachmentCount(t *testing.T) {
	env := setupCardsEnv(t)

	card, err := env.app.FindRecordById("cards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("find card: %v", err)
	}
	card.Set("attachment_count", 42)
	if err := env.app.Save(card); err != nil {
		t.Fatalf("save inflated count: %v", err)
	}

	recountCard(env.app, env.card.Id)

	fresh, err := env.app.FindRecordById("cards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("re-read card: %v", err)
	}
	if got := fresh.GetInt("attachment_count"); got != 0 {
		t.Errorf("attachment_count = %d, want 0 — a client-supplied value survived the recount", got)
	}
}

// Counts must fall as well as rise — a delete-driven recount that only ever
// grew would look correct on every create-only test.
func TestCardsCounters_RecountFallsAfterDelete(t *testing.T) {
	env := setupCardsEnv(t)

	item := cardsChecklistItem(t, env.app, env.project, env.card, "one", "a0")
	recountCard(env.app, env.card.Id)

	if err := env.app.Delete(item); err != nil {
		t.Fatalf("delete item: %v", err)
	}
	recountCard(env.app, env.card.Id)

	fresh, err := env.app.FindRecordById("cards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("re-read card: %v", err)
	}
	if got := fresh.GetInt("checklist_total"); got != 0 {
		t.Errorf("checklist_total = %d, want 0 after delete", got)
	}
}

// A deleted card cascades to its children, so the hooks fire once per child
// with the parent already gone. That is the common path, not an anomaly, and it
// must not panic or error.
func TestCardsCounters_RecountOnMissingCardIsQuiet(t *testing.T) {
	env := setupCardsEnv(t)
	recountCard(env.app, "nonexistent-card-id")
	recountCard(env.app, "")
}

// Counters are server-maintained: a client that sends its own values must not
// have them believed. The rules do not pin these fields (they are not
// relations), so this documents the actual exposure — a member CAN write them
// directly, and the next recount corrects it.
func TestCardsCounters_RecountOverwritesClientSuppliedValues(t *testing.T) {
	env := setupCardsEnv(t)

	card, err := env.app.FindRecordById("cards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("find card: %v", err)
	}
	card.Set("comment_count", 99)
	if err := env.app.Save(card); err != nil {
		t.Fatalf("save inflated count: %v", err)
	}

	recountCard(env.app, env.card.Id)

	fresh, err := env.app.FindRecordById("cards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("re-read card: %v", err)
	}
	if got := fresh.GetInt("comment_count"); got != 0 {
		t.Errorf("comment_count = %d, want 0 — a client-supplied value survived the recount", got)
	}
}

// The wiring, not the arithmetic: an OnRecordAfterCreateSuccess on
// cards_checklist_items must actually reach the card. Without this, every
// assertion above could pass while the counters never updated in production,
// because they all call recountCard by hand.
//
// registerBoardCounters binds against *pocketbase.PocketBase, so the hook is
// re-bound here directly on the test app's equivalent event to exercise the
// same path the generated Register() takes.
func TestCardsCounters_CreateHookReachesTheCard(t *testing.T) {
	env := setupCardsEnv(t)

	env.app.OnRecordAfterCreateSuccess("cards_checklist_items").BindFunc(func(e *core.RecordEvent) error {
		recountCard(e.App, e.Record.GetString("card"))
		return e.Next()
	})

	cardsChecklistItem(t, env.app, env.project, env.card, "one", "a0")

	fresh, err := env.app.FindRecordById("cards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("re-read card: %v", err)
	}
	if got := fresh.GetInt("checklist_total"); got != 1 {
		t.Fatalf("checklist_total = %d, want 1 — the create hook did not reach the card", got)
	}
}
