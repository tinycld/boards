package cards

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Due-date notices: once per boundary per due date, surviving restarts via
// the two stamps, and never for finished work.

func setupDueEnv(t *testing.T) *cardsEnv {
	t.Helper()
	env := setupCardsEnv(t)
	addNotificationsCollection(t, env.app)
	registerDueNotices(env.app)
	return env
}

func setDue(t *testing.T, app core.App, cardID string, due time.Time, assignee string) {
	t.Helper()
	card, err := app.FindRecordById("cards_cards", cardID)
	if err != nil {
		t.Fatal(err)
	}
	card.Set("due", due.UTC().Format(pbDateFormat))
	if assignee != "" {
		card.Set("assignees", []string{assignee})
	}
	if err := app.Save(card); err != nil {
		t.Fatal(err)
	}
}

func TestDueNotices_OverdueFiresOnceAndStamps(t *testing.T) {
	env := setupDueEnv(t)
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	setDue(t, env.app, env.card.Id, now.AddDate(0, 0, -1), env.editor.Id)

	checkDueNotices(env.app, now)
	notes := notificationsFor(t, env.app, env.editor.Id)
	if len(notes) != 1 || notes[0].GetString("type") != notifyTypeDue || eventOf(t, notes[0]) != "overdue" {
		t.Fatalf("got %v, want one overdue cards_due", notificationTypes(t, env.app, env.editor.Id))
	}

	// A second sweep is a no-op: the stamp survived the save.
	checkDueNotices(env.app, now.Add(time.Hour))
	if got := len(notificationsFor(t, env.app, env.editor.Id)); got != 1 {
		t.Fatalf("second sweep sent again: %d notifications", got)
	}
	card, _ := env.app.FindRecordById("cards_cards", env.card.Id)
	if card.GetDateTime("overdue_notified_at").IsZero() {
		t.Fatalf("overdue stamp not written")
	}
}

func TestDueNotices_SoonFiresInsideTheWindowOnly(t *testing.T) {
	env := setupDueEnv(t)
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	setDue(t, env.app, env.card.Id, now.AddDate(0, 0, 5), env.editor.Id)

	checkDueNotices(env.app, now)
	requireTypes(t, notificationTypes(t, env.app, env.editor.Id))

	// Two days out: inside the window lib/due-state.ts calls "soon".
	checkDueNotices(env.app, now.AddDate(0, 0, 3))
	notes := notificationsFor(t, env.app, env.editor.Id)
	if len(notes) != 1 || eventOf(t, notes[0]) != "soon" {
		t.Fatalf("got %v, want one soon notice", notificationTypes(t, env.app, env.editor.Id))
	}
}

func TestDueNotices_ChangingTheDueDateResetsTheStamps(t *testing.T) {
	env := setupDueEnv(t)
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	setDue(t, env.app, env.card.Id, now.AddDate(0, 0, -1), env.editor.Id)
	checkDueNotices(env.app, now)

	// Pushed out a week: a new deadline, so both notices are live again.
	setDue(t, env.app, env.card.Id, now.AddDate(0, 0, 7), "")
	card, _ := env.app.FindRecordById("cards_cards", env.card.Id)
	if !card.GetDateTime("overdue_notified_at").IsZero() || !card.GetDateTime("due_soon_notified_at").IsZero() {
		t.Fatalf("stamps survived a due-date change")
	}
	checkDueNotices(env.app, now.AddDate(0, 0, 8))
	if got := len(notificationsFor(t, env.app, env.editor.Id)); got != 2 {
		t.Fatalf("got %d notifications, want the original overdue plus a new one", got)
	}
}

func TestDueNotices_ArchivedAndDoneCardsAreSkipped(t *testing.T) {
	env := setupDueEnv(t)
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	setDue(t, env.app, env.card.Id, now.AddDate(0, 0, -1), env.editor.Id)
	card, _ := env.app.FindRecordById("cards_cards", env.card.Id)
	card.Set("archived", true)
	if err := env.app.Save(card); err != nil {
		t.Fatal(err)
	}
	checkDueNotices(env.app, now)
	requireTypes(t, notificationTypes(t, env.app, env.editor.Id))

	done := cardsList(t, env.app, env.project, "Done", "a2")
	done.Set("is_done", true)
	if err := env.app.Save(done); err != nil {
		t.Fatal(err)
	}
	other := cardsCard(t, env.app, env.project, done, "finished", "a0", env.owner)
	setDue(t, env.app, other.Id, now.AddDate(0, 0, -1), env.editor.Id)
	checkDueNotices(env.app, now)
	requireTypes(t, notificationTypes(t, env.app, env.editor.Id))
}

func TestDueNotices_ClientCannotForgeOrEraseAStamp(t *testing.T) {
	env := setupDueEnv(t)
	card, _ := env.app.FindRecordById("cards_cards", env.card.Id)
	card.Set("title", "renamed")
	card.Set("overdue_notified_at", types.NowDateTime())
	if err := env.app.Save(card); err != nil {
		t.Fatal(err)
	}
	if got := card.GetDateTime("overdue_notified_at"); !got.IsZero() {
		t.Fatalf("forged stamp survived: %v", got)
	}

	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	setDue(t, env.app, env.card.Id, now.AddDate(0, 0, -1), env.editor.Id)
	checkDueNotices(env.app, now)
	card, _ = env.app.FindRecordById("cards_cards", env.card.Id)
	card.Set("title", "renamed again")
	card.Set("overdue_notified_at", "")
	if err := env.app.Save(card); err != nil {
		t.Fatal(err)
	}
	if card.GetDateTime("overdue_notified_at").IsZero() {
		t.Fatalf("a client erased the stamp")
	}
}
