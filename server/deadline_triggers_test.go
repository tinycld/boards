package boards

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/automation"
)

// The deadline triggers (card-overdue, card-due-soon) turn the existing
// due-notice sweep into automation without adding any scheduling of its own:
// the sweep stamps a card and saves it, and that save runs the ordinary
// after-update hook the engine binds.
//
// These tests drive the REAL sweep (checkDueNotices) rather than hand-setting
// stamps, so they fail if either half of that contract moves.

// setupDeadlineEnv gives the automation env a due-notice registration, so the
// stamp-restore hook is live exactly as it is in production.
func setupDeadlineEnv(t *testing.T) *cardsAutomationEnv {
	t.Helper()
	env := setupCardsAutomation(t)
	addNotificationsCollection(t, env.app)
	registerDueNotices(env.app)
	return env
}

// dueCard makes a card in `list` due at `due`.
func dueCard(t *testing.T, env *cardsAutomationEnv, list *core.Record, title, rank string, due time.Time) *core.Record {
	t.Helper()
	card := cardsCard(t, env.app, env.project, list, title, rank, env.owner)
	card.Set("due", due.UTC().Format(pbDateFormat))
	if err := env.app.Save(card); err != nil {
		t.Fatalf("set due on %s: %v", title, err)
	}
	return card
}

// sweptRecord runs one sweep and returns the card as the after-update hook saw
// it — the record the engine would hand a TriggerFilter.
func sweptRecord(t *testing.T, env *cardsAutomationEnv, cardID string, now time.Time) *core.Record {
	t.Helper()
	var seen *core.Record
	env.app.OnRecordAfterUpdateSuccess("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.Id == cardID {
			seen = e.Record
		}
		return e.Next()
	})
	checkDueNotices(env.app, now)
	if seen == nil {
		t.Fatalf("the sweep saved no update for card %s", cardID)
	}
	return seen
}

func TestCardBecameOverdue_FiresOnTheSweepsStamp(t *testing.T) {
	env := setupDeadlineEnv(t)
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	card := dueCard(t, env, env.todo, "Late", "a", now.AddDate(0, 0, -1))

	swept := sweptRecord(t, env, card.Id, now)

	if !automation.WatchChanged(swept, []string{"overdue_notified_at"}) {
		t.Fatal("the sweep's stamp must read as a change to the watched column")
	}
	if !cardBecameOverdue(env.app, swept) {
		t.Fatal("a card the sweep just stamped overdue must fire card-overdue")
	}
}

// The event is the stamp being SET. Rescheduling CLEARS both stamps, and a
// cleared stamp is the opposite of "this card is late".
func TestCardBecameOverdue_RefusesAClearedStamp(t *testing.T) {
	env := setupDeadlineEnv(t)
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	card := dueCard(t, env, env.todo, "Late", "a", now.AddDate(0, 0, -1))
	checkDueNotices(env.app, now)

	// Push the deadline out: registerDueNotices clears both stamps.
	var seen *core.Record
	env.app.OnRecordAfterUpdateSuccess("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.Id == card.Id {
			seen = e.Record
		}
		return e.Next()
	})
	fresh, err := env.app.FindRecordById("boards_cards", card.Id)
	if err != nil {
		t.Fatal(err)
	}
	fresh.Set("due", now.AddDate(0, 0, 30).UTC().Format(pbDateFormat))
	if err := env.app.Save(fresh); err != nil {
		t.Fatal(err)
	}

	if seen == nil {
		t.Fatal("reschedule produced no update event")
	}
	if !automation.WatchChanged(seen, []string{"overdue_notified_at"}) {
		t.Fatal("precondition: clearing the stamp is a change to the watched column")
	}
	if cardBecameOverdue(env.app, seen) {
		t.Fatal("rescheduling a card must NOT fire card-overdue — the stamp was cleared, not set")
	}
}

// An ordinary edit is the case that would make these triggers unusable: it must
// not fire, even though the stamp-restore hook re-Sets both columns.
func TestDeadlineTriggers_IgnoreAnOrdinaryEdit(t *testing.T) {
	env := setupDeadlineEnv(t)
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	card := dueCard(t, env, env.todo, "Late", "a", now.AddDate(0, 0, -1))
	checkDueNotices(env.app, now)

	var seen *core.Record
	env.app.OnRecordAfterUpdateSuccess("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.Id == card.Id {
			seen = e.Record
		}
		return e.Next()
	})
	fresh, err := env.app.FindRecordById("boards_cards", card.Id)
	if err != nil {
		t.Fatal(err)
	}
	fresh.Set("title", "renamed by a person")
	if err := env.app.Save(fresh); err != nil {
		t.Fatal(err)
	}

	if seen == nil {
		t.Fatal("the edit produced no update event")
	}
	if cardBecameOverdue(env.app, seen) {
		t.Fatal("an ordinary edit must not fire card-overdue")
	}
	if cardBecameDueSoon(env.app, seen) {
		t.Fatal("an ordinary edit must not fire card-due-soon")
	}
}

// Finished work is not late, whichever way it finished.
func TestCardBecameOverdue_RefusesAClosedCard(t *testing.T) {
	env := setupDeadlineEnv(t)
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	card := dueCard(t, env, env.done, "Shipped late but shipped", "a", now.AddDate(0, 0, -1))

	// The sweep itself skips closed cards, so stamp it directly: the filter is
	// the second line of defence, and it must hold on its own.
	fresh, err := env.app.FindRecordById("boards_cards", card.Id)
	if err != nil {
		t.Fatal(err)
	}
	fresh.Set("overdue_notified_at", now.UTC().Format(pbDateFormat))

	if cardBecameOverdue(env.app, fresh) {
		t.Fatal("a card in a done list must never fire card-overdue")
	}
}

func TestCardBecameDueSoon_FiresInsideTheWindow(t *testing.T) {
	env := setupDeadlineEnv(t)
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	card := dueCard(t, env, env.todo, "Soon", "a", now.AddDate(0, 0, 1))

	swept := sweptRecord(t, env, card.Id, now)

	if !cardBecameDueSoon(env.app, swept) {
		t.Fatal("a card the sweep just stamped due-soon must fire card-due-soon")
	}
	if cardBecameOverdue(env.app, swept) {
		t.Fatal("a card that is merely due soon must not fire card-overdue")
	}
}

// The sweep stamps due_soon_notified_at even when it sends NO soon notice: a
// card first seen already overdue gets the overdue notice only, and the soon
// stamp is written to suppress stale news. Reading that stamp alone would fire
// "due soon" on a card that is in fact late.
func TestCardBecameDueSoon_RefusesACardThatIsAlreadyOverdue(t *testing.T) {
	env := setupDeadlineEnv(t)
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	card := dueCard(t, env, env.todo, "Already late", "a", now.AddDate(0, 0, -1))

	swept := sweptRecord(t, env, card.Id, now)

	if swept.GetDateTime("due_soon_notified_at").IsZero() {
		t.Fatal("precondition: the sweep stamps the soon column to suppress stale news")
	}
	if cardBecameDueSoon(env.app, swept) {
		t.Fatal("an already-overdue card must NOT fire card-due-soon")
	}
	if !cardBecameOverdue(env.app, swept) {
		t.Fatal("it must fire card-overdue instead")
	}
}

func TestDeadlineFilters_FailClosedOnANilRecord(t *testing.T) {
	env := setupDeadlineEnv(t)
	if cardBecameOverdue(env.app, nil) {
		t.Error("a nil record must not fire card-overdue")
	}
	if cardBecameDueSoon(env.app, nil) {
		t.Error("a nil record must not fire card-due-soon")
	}
}
