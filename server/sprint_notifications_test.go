package boards

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// The sprint notice: every board member except the actor, on start and on
// completion, through the real notify path.

func setupSprintNotifyEnv(t *testing.T) *cardsEnv {
	t.Helper()
	env := setupNotifyEnv(t)
	registerSprintGuard(env.app)
	registerSprintOwnedColumns(env.app)
	return env
}

func loadedSprint(t *testing.T, app core.App, id string) *core.Record {
	t.Helper()
	sprint, err := app.FindRecordById("boards_sprints", id)
	if err != nil {
		t.Fatal(err)
	}
	return sprint
}

func TestSprintNotifications_MembersAreToldOnStart(t *testing.T) {
	env := setupSprintNotifyEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")

	// "After" is the loaded row with the state set: the after-save hook's view.
	after := loadedSprint(t, env.app, sprint.Id)
	after.Set("state", sprintActive)
	notifySprintTransition(env.app, after, env.owner.Id)

	for _, member := range []*core.Record{env.editor, env.commentor, env.viewer} {
		requireTypes(t, notificationTypes(t, env.app, member.Id), notifyTypeSprint)
	}
	// The actor is never told about their own action.
	requireTypes(t, notificationTypes(t, env.app, env.owner.Id))
	// An outsider is not on the board.
	requireTypes(t, notificationTypes(t, env.app, env.outsider.Id))

	got := notificationsFor(t, env.app, env.editor.Id)[0]
	if eventOf(t, got) != "started" {
		t.Fatalf("event = %q, want started", eventOf(t, got))
	}
}

func TestSprintNotifications_TheSweepTellsEveryone(t *testing.T) {
	env := setupSprintNotifyEnv(t)
	// Unnamed: the headline falls back to the number.
	sprint := cardsSprint(t, env.app, env.project, "", "a0")
	advanceSprint(t, env.app, sprint.Id, sprintActive)

	after := loadedSprint(t, env.app, sprint.Id)
	after.Set("state", sprintCompleted)
	notifySprintTransition(env.app, after, "")

	requireTypes(t, notificationTypes(t, env.app, env.owner.Id), notifyTypeSprint)
	got := notificationsFor(t, env.app, env.owner.Id)[0]
	if eventOf(t, got) != "completed" {
		t.Fatalf("event = %q, want completed", eventOf(t, got))
	}
	if title := got.GetString("title"); title != "Sprint 1 completed" {
		t.Fatalf("title = %q", title)
	}
}

func TestSprintNotifications_AnEditIsNotATransition(t *testing.T) {
	env := setupSprintNotifyEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	after := loadedSprint(t, env.app, sprint.Id)
	after.Set("goal", "renamed")
	notifySprintTransition(env.app, after, env.owner.Id)
	requireTypes(t, notificationTypes(t, env.app, env.editor.Id))
}
