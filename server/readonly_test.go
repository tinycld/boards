package boards

import (
	"context"
	"log/slog"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"tinycld.org/core/readonly"
	"tinycld.org/core/readonly/readonlytest"
)

// Boards' background writes happen outside a request, so read-only mode's
// middleware cannot refuse them. The notification jobs wait the mode out;
// the sweeps skip a tick that falls inside it and stop when it starts.
// readonly's state is process-wide, so none of these tests run in parallel.

// A reaction written just before the server went read-only must not notify
// while the mode is on: the row is lost if the next build rolls back. It
// waits, and notifies once the mode ends.
func TestNotification_WaitsForReadOnlyToEnd(t *testing.T) {
	env := setupNotifyEnv(t)
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "hello")
	reaction := seedReaction(t, env, comment.Id, env.commentor.Id, "👍")
	readonly.Enter(env.app)
	t.Cleanup(func() { readonly.Leave(env.app) })

	probe, waiting := readonlytest.WaitProbe(t)
	done := make(chan struct{})
	go func() {
		defer close(done)
		notifyWhenWritable(probe, env.app, "boards reaction notification", reaction.Id, func() {
			notifyReaction(env.app, reaction)
		})
	}()
	select {
	case <-waiting:
	case <-done:
		t.Fatal("the notification was written without waiting for read-only mode to end")
	case <-time.After(5 * time.Second):
		t.Fatal("the notification never reached the read-only wait")
	}
	requireTypes(t, notificationTypes(t, env.app, env.editor.Id))

	readonly.Leave(env.app)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the notification was not written after read-only mode ended")
	}
	requireTypes(t, notificationTypes(t, env.app, env.editor.Id), notifyTypeReaction)
}

func TestNotification_DroppedAndLoggedWhenReadOnlyOutlastsTheWait(t *testing.T) {
	env := setupNotifyEnv(t)
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "hello")
	reaction := seedReaction(t, env, comment.Id, env.commentor.Id, "👍")
	logs := readonlytest.CaptureLogs(t)
	readonly.Enter(env.app)
	t.Cleanup(func() { readonly.Leave(env.app) })

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	notifyWhenWritable(ctx, env.app, "boards reaction notification", reaction.Id, func() {
		notifyReaction(env.app, reaction)
	})

	requireTypes(t, notificationTypes(t, env.app, env.editor.Id))
	r, ok := readonlytest.Find(logs(), notifyDroppedMsg)
	if !ok {
		t.Fatalf("no %q log for the dropped notification", notifyDroppedMsg)
	}
	if r.Level != slog.LevelWarn {
		t.Fatalf("want Warn for a dropped notification, got %v", r.Level)
	}
	if r.Attrs["pkg"] != "boards" || r.Attrs["job"] != "boards reaction notification" || r.Attrs["record"] != reaction.Id {
		t.Fatalf("the log must name boards, the job and the record, got %v", r.Attrs)
	}
}

// Every notification hook goes through the wait. With the mode on, no job
// writes; the app's terminate then ends each wait, and each job logs its
// drop by name.
func TestNotificationHooks_WaitWhileReadOnlyAndDropAtTerminate(t *testing.T) {
	env := setupNotifyEnv(t)
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "before")
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	// Bound after the seed rows, so no job from a write made before the
	// mode can land a notification during it.
	registerCardNotifications(env.app)
	registerSprintNotifications(env.app)
	logs := readonlytest.CaptureLogs(t)
	readonly.Enter(env.app)
	t.Cleanup(func() { readonly.Leave(env.app) })

	card := loaded(t, env.app, env.card.Id)
	card.Set("title", "renamed while read-only")
	if err := env.app.Save(card); err != nil {
		t.Fatal(err)
	}
	cardsComment(t, env.app, env.project, env.card, env.commentor, "during")
	seedReaction(t, env, comment.Id, env.commentor.Id, "👍")
	updated := loadedSprint(t, env.app, sprint.Id)
	updated.Set("goal", "renamed while read-only")
	if err := env.app.Save(updated); err != nil {
		t.Fatal(err)
	}

	if n, err := env.app.CountRecords("notifications"); err != nil || n != 0 {
		t.Fatalf("notifications written while read-only: %d (err %v)", n, err)
	}
	env.app.Cleanup()

	dropped := map[string]bool{}
	for _, r := range logs() {
		if r.Msg == notifyDroppedMsg {
			dropped[r.Attrs["job"]] = true
		}
	}
	for _, job := range []string{
		"boards card notification",
		"boards comment notification",
		"boards reaction notification",
		"boards sprint notification",
	} {
		if !dropped[job] {
			t.Errorf("%q did not wait for read-only mode and log its drop at terminate; dropped: %v", job, dropped)
		}
	}
}

// A tick that falls while read-only is skipped, and the skipped ticks are
// not queued: once the mode ends, the next tick runs the sweep once. The fake
// clock makes "it did not run for three ticks" exact.
func TestSweepEvery_SkipsTicksWhileReadOnlyAndRunsAfter(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)
	readonly.Enter(app) // outside the bubble: the mode's channel is made outside it
	t.Cleanup(func() { readonly.Leave(app) })
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		var ran atomic.Int32
		done := make(chan struct{})
		go func() {
			defer close(done)
			sweepEvery(ctx, app, "probe", time.Minute, func(time.Time) { ran.Add(1) })
		}()

		time.Sleep(3*time.Minute + time.Second)
		synctest.Wait()
		if got := ran.Load(); got != 0 {
			t.Fatalf("the sweep ran %d times while read-only", got)
		}

		readonly.Leave(app)
		time.Sleep(time.Minute)
		synctest.Wait()
		if got := ran.Load(); got != 1 {
			t.Fatalf("the sweep ran %d times on the first tick after read-only, want 1", got)
		}
		cancel()
		<-done
	})
}

// Each sweep checks the mode itself too, so a sweep called while read-only
// writes nothing, and the same sweep after the mode ends does the work.
func TestDueNotices_WriteNothingWhileReadOnly(t *testing.T) {
	env := setupDueEnv(t)
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	setDue(t, env.app, env.card.Id, now.AddDate(0, 0, -1), env.editor.Id)
	readonly.Enter(env.app)
	t.Cleanup(func() { readonly.Leave(env.app) })

	checkDueNotices(env.app, now)
	requireTypes(t, notificationTypes(t, env.app, env.editor.Id))
	if !loaded(t, env.app, env.card.Id).GetDateTime("overdue_notified_at").IsZero() {
		t.Fatal("the overdue stamp was written while read-only")
	}

	readonly.Leave(env.app)
	checkDueNotices(env.app, now)
	requireTypes(t, notificationTypes(t, env.app, env.editor.Id), notifyTypeDue)
}

func TestAutoArchive_WritesNothingWhileReadOnly(t *testing.T) {
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	env := setupAutoArchive(t, 7)
	card := agedCard(t, env, env.done, "old done", 8*24*time.Hour, now)
	readonly.Enter(env.app)
	t.Cleanup(func() { readonly.Leave(env.app) })

	sweepAutoArchive(env.app, now)
	if isArchived(t, env.app, card.Id) {
		t.Fatal("a card was archived while read-only")
	}

	readonly.Leave(env.app)
	sweepAutoArchive(env.app, now)
	if !isArchived(t, env.app, card.Id) {
		t.Fatal("the card was not archived after read-only mode ended")
	}
}

// The mode can start while a sweep runs. The sweep stops at its next card
// rather than keep writing into the pause; the rest is archived on the next
// sweep after the mode ends.
func TestAutoArchive_StopsWhenReadOnlyStartsMidSweep(t *testing.T) {
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	env := setupAutoArchive(t, 7)
	day := 24 * time.Hour
	first := agedCard(t, env, env.done, "old done", 8*day, now)
	second := agedCard(t, env, env.canceled, "old canceled", 8*day, now)
	t.Cleanup(func() { readonly.Leave(env.app) })
	env.app.OnRecordAfterUpdateSuccess("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetBool("archived") {
			readonly.Enter(env.app)
		}
		return e.Next()
	})

	sweepAutoArchive(env.app, now)
	archived := 0
	for _, id := range []string{first.Id, second.Id} {
		if isArchived(t, env.app, id) {
			archived++
		}
	}
	if archived != 1 {
		t.Fatalf("archived %d cards, want the sweep to stop after the first", archived)
	}

	readonly.Leave(env.app)
	sweepAutoArchive(env.app, now)
	if !isArchived(t, env.app, first.Id) || !isArchived(t, env.app, second.Id) {
		t.Fatal("the next sweep after read-only did not archive the rest")
	}
}

func TestSprintSweep_WritesNothingWhileReadOnly(t *testing.T) {
	env := setupSweepEnv(t, true, false, "next")
	sprint := datedSprint(t, env, "Today", "a0", "2026-09-04 00:00:00.000Z", "2026-09-17 00:00:00.000Z")
	readonly.Enter(env.app)
	t.Cleanup(func() { readonly.Leave(env.app) })

	sweepSprints(env.app, env.now)
	if reloadSprint(t, env.app, sprint.Id).GetString("state") != sprintPlanned {
		t.Fatal("a sprint was started while read-only")
	}

	readonly.Leave(env.app)
	sweepSprints(env.app, env.now)
	if reloadSprint(t, env.app, sprint.Id).GetString("state") != sprintActive {
		t.Fatal("the sprint was not started after read-only mode ended")
	}
}
