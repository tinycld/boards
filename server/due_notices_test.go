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

func TestDueNotices_ArchivedAndClosedCardsAreSkipped(t *testing.T) {
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
	done.Set("category", "done")
	if err := env.app.Save(done); err != nil {
		t.Fatal(err)
	}
	other := cardsCard(t, env.app, env.project, done, "finished", "a0", env.owner)
	setDue(t, env.app, other.Id, now.AddDate(0, 0, -1), env.editor.Id)
	checkDueNotices(env.app, now)
	requireTypes(t, notificationTypes(t, env.app, env.editor.Id))

	// Canceled is finished too: dropped work is not late either.
	canceled := cardsList(t, env.app, env.project, "Won't do", "a3")
	canceled.Set("category", "canceled")
	if err := env.app.Save(canceled); err != nil {
		t.Fatal(err)
	}
	dropped := cardsCard(t, env.app, env.project, canceled, "dropped", "a0", env.owner)
	setDue(t, env.app, dropped.Id, now.AddDate(0, 0, -1), env.editor.Id)
	checkDueNotices(env.app, now)
	requireTypes(t, notificationTypes(t, env.app, env.editor.Id))
}

// A backlog list is not closed: a due date there is an explicit ask, and the
// reminder still fires.
func TestDueNotices_BacklogCardsStillNotify(t *testing.T) {
	env := setupDueEnv(t)
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	backlog := cardsList(t, env.app, env.project, "Backlog", "a2")
	backlog.Set("category", "backlog")
	if err := env.app.Save(backlog); err != nil {
		t.Fatal(err)
	}
	card := cardsCard(t, env.app, env.project, backlog, "someday", "a0", env.owner)
	setDue(t, env.app, card.Id, now.AddDate(0, 0, -1), env.editor.Id)
	checkDueNotices(env.app, now)
	requireTypes(t, notificationTypes(t, env.app, env.editor.Id), notifyTypeDue)
}

// A timed deadline is overdue from its instant, on the same day; the same
// instant without the flag is still "today", so only "soon" fires.
func TestDueNotices_TimedDeadlineIsOverdueFromItsInstant(t *testing.T) {
	env := setupDueEnv(t)
	now := time.Date(2026, 9, 3, 15, 0, 0, 0, time.UTC)

	timed := cardsCard(t, env.app, env.project, env.list, "timed", "a0", env.owner)
	setDue(t, env.app, timed.Id, now.Add(-time.Hour), env.editor.Id)
	setDueHasTime(t, env.app, timed.Id, true)
	dayOnly := cardsCard(t, env.app, env.project, env.list, "day", "a1", env.owner)
	setDue(t, env.app, dayOnly.Id, now.Add(-time.Hour), env.editor.Id)

	checkDueNotices(env.app, now)
	events := map[string]int{}
	for _, n := range notificationsFor(t, env.app, env.editor.Id) {
		events[eventOf(t, n)]++
	}
	// The timed card: overdue only (already late when first seen). The
	// day-only card at the same instant: soon only.
	if events["overdue"] != 1 || events["soon"] != 1 {
		t.Fatalf("events = %v, want one overdue (timed) and one soon (day-only)", events)
	}
}

// Giving a due date a time is a new deadline: the stamps reset even though
// the stored instant is the same day.
func TestDueNotices_AddingATimeResetsTheStamps(t *testing.T) {
	env := setupDueEnv(t)
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	setDue(t, env.app, env.card.Id, now.AddDate(0, 0, -1), env.editor.Id)
	checkDueNotices(env.app, now)
	if got := len(notificationsFor(t, env.app, env.editor.Id)); got != 1 {
		t.Fatalf("got %d notifications, want 1", got)
	}
	setDueHasTime(t, env.app, env.card.Id, true)
	card, _ := env.app.FindRecordById("cards_cards", env.card.Id)
	if !card.GetDateTime("overdue_notified_at").IsZero() {
		t.Fatalf("stamps survived a flag change")
	}
	checkDueNotices(env.app, now)
	if got := len(notificationsFor(t, env.app, env.editor.Id)); got != 2 {
		t.Fatalf("got %d notifications, want the original plus a new one", got)
	}
}

func setDueHasTime(t *testing.T, app core.App, cardID string, hasTime bool) {
	t.Helper()
	card, err := app.FindRecordById("cards_cards", cardID)
	if err != nil {
		t.Fatal(err)
	}
	card.Set("due_has_time", hasTime)
	if err := app.Save(card); err != nil {
		t.Fatal(err)
	}
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
