package cards

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// The auto-archive sweep, driven with a fixed clock. The activity hooks are
// bound so the sweep's own save is proven to land as a system write.

type autoArchiveEnv struct {
	*cardsEnv
	todo     *core.Record
	done     *core.Record
	canceled *core.Record
}

func setupAutoArchive(t *testing.T, days int) *autoArchiveEnv {
	t.Helper()
	env := setupActivityEnv(t)
	env.project.Set("auto_archive_days", days)
	if err := env.app.Save(env.project); err != nil {
		t.Fatal(err)
	}
	todo := cardsList(t, env.app, env.project, "To do", "a7")
	done := cardsList(t, env.app, env.project, "Done", "a8")
	done.Set("category", "done")
	if err := env.app.Save(done); err != nil {
		t.Fatal(err)
	}
	canceled := cardsList(t, env.app, env.project, "Won't do", "a9")
	canceled.Set("category", "canceled")
	if err := env.app.Save(canceled); err != nil {
		t.Fatal(err)
	}
	return &autoArchiveEnv{cardsEnv: env, todo: todo, done: done, canceled: canceled}
}

// agedCard files a card in `list` that entered it `age` ago.
func agedCard(t *testing.T, env *autoArchiveEnv, list *core.Record, title string, age time.Duration, now time.Time) *core.Record {
	t.Helper()
	card := cardsCard(t, env.app, env.project, list, title, "a0", env.owner)
	stamp, err := types.ParseDateTime(now.Add(-age))
	if err != nil {
		t.Fatal(err)
	}
	card.Set("list_changed_at", stamp)
	if err := env.app.Save(card); err != nil {
		t.Fatal(err)
	}
	return card
}

func isArchived(t *testing.T, app core.App, id string) bool {
	t.Helper()
	card, err := app.FindRecordById("cards_cards", id)
	if err != nil {
		t.Fatal(err)
	}
	return card.GetBool("archived")
}

func TestAutoArchive_ArchivesOnlyAgedClosedCards(t *testing.T) {
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	env := setupAutoArchive(t, 7)
	day := 24 * time.Hour

	oldDone := agedCard(t, env, env.done, "old done", 8*day, now)
	oldCanceled := agedCard(t, env, env.canceled, "old canceled", 8*day, now)
	recentDone := agedCard(t, env, env.done, "recent done", 6*day, now)
	oldTodo := agedCard(t, env, env.todo, "old todo", 8*day, now)

	sweepAutoArchive(env.app, now)

	if !isArchived(t, env.app, oldDone.Id) {
		t.Error("a card 8 days in a done list must be archived at 7")
	}
	if !isArchived(t, env.app, oldCanceled.Id) {
		t.Error("a card 8 days in a canceled list must be archived at 7")
	}
	if isArchived(t, env.app, recentDone.Id) {
		t.Error("a card 6 days in a done list must NOT be archived at 7")
	}
	if isArchived(t, env.app, oldTodo.Id) {
		t.Error("a card in an open list must never be auto-archived")
	}

	// The sweep's save is a system write: history says so, with no actor.
	rows := activityRows(t, env.app, oldDone.Id)
	archived := rowOfKind(t, rows, "archived")
	if actor := archived.GetString("actor"); actor != "" {
		t.Errorf("auto-archive row actor = %q, want none", actor)
	}

	// A second sweep is a no-op: nothing left to archive, nothing re-archived.
	before := len(activityRows(t, env.app, oldDone.Id))
	sweepAutoArchive(env.app, now)
	if after := len(activityRows(t, env.app, oldDone.Id)); after != before {
		t.Errorf("a second sweep wrote %d more history rows", after-before)
	}
}

func TestAutoArchive_ZeroDaysNeverArchives(t *testing.T) {
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	env := setupAutoArchive(t, 0)
	ancient := agedCard(t, env, env.done, "ancient", 400*24*time.Hour, now)
	sweepAutoArchive(env.app, now)
	if isArchived(t, env.app, ancient.Id) {
		t.Error("auto_archive_days = 0 means never")
	}
}

func TestAutoArchive_SkipsArchivedBoardsAndUnstampedCards(t *testing.T) {
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	env := setupAutoArchive(t, 7)

	unstamped := cardsCard(t, env.app, env.project, env.done, "unstamped", "a0", env.owner)
	sweepAutoArchive(env.app, now)
	if isArchived(t, env.app, unstamped.Id) {
		t.Error("a card with no list_changed_at has no age and must be left alone")
	}

	aged := agedCard(t, env, env.done, "aged", 30*24*time.Hour, now)
	env.project.Set("archived", true)
	if err := env.app.Save(env.project); err != nil {
		t.Fatal(err)
	}
	sweepAutoArchive(env.app, now)
	if isArchived(t, env.app, aged.Id) {
		t.Error("an archived board's cards are already out of the way; the sweep must skip it")
	}
}
