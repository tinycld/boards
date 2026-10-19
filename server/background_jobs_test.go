package boards

import (
	"sync"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/readonly/readonlytest"
)

// The notification hooks hand off to background jobs. A panic in one (here,
// in the save of the notification row) must be logged through the boards
// logger, not end the process, and the app's terminate must wait for the job
// so it never runs against a closed database.
func TestReactionNotification_PanicRecoveredAndTerminateWaits(t *testing.T) {
	logs := readonlytest.CaptureLogs(t)
	env := setupNotifyEnv(t)
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "hello")

	var once sync.Once
	entered := make(chan struct{})
	release := make(chan struct{})
	env.app.OnRecordCreate("notifications").BindFunc(func(*core.RecordEvent) error {
		once.Do(func() { close(entered) })
		<-release
		panic("notification save exploded")
	})
	registerCardNotifications(env.app)

	seedReaction(t, env, comment.Id, env.commentor.Id, "👍")

	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("the reaction notification job never ran")
	}
	cleaned := make(chan struct{})
	go func() {
		env.app.Cleanup()
		close(cleaned)
	}()
	select {
	case <-cleaned:
		t.Fatal("the terminate finished while the reaction notification was still running")
	case <-time.After(50 * time.Millisecond):
	}

	close(release)
	select {
	case <-cleaned:
	case <-time.After(10 * time.Second):
		t.Fatal("the terminate did not finish after the job returned")
	}
	for _, r := range logs() {
		if r.Msg == "background job panicked" && r.Attrs["job"] == "boards reaction notification" {
			if r.Attrs["pkg"] != "boards" {
				t.Fatalf("the panic must be logged through the boards logger, got %v", r.Attrs)
			}
			return
		}
	}
	t.Fatal("the reaction notification's panic was not logged")
}
