package boards

import (
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// The sprint invariants sprint_guard.go enforces, driven through app.Save so
// the model hooks run exactly as they do for a request.

func newSprintRecord(t *testing.T, env *cardsEnv, state string) *core.Record {
	t.Helper()
	col, err := env.app.FindCollectionByNameOrId("boards_sprints")
	if err != nil {
		t.Fatalf("find boards_sprints: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("project", env.project.Id)
	r.Set("name", "Sprint")
	r.Set("position", "a0")
	r.Set("state", state)
	return r
}

func requireRefused(t *testing.T, err error, fragment string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected a refusal mentioning %q, got nil", fragment)
	}
	if !strings.Contains(err.Error(), fragment) {
		t.Fatalf("refusal %q does not mention %q", err.Error(), fragment)
	}
}

func TestSprintGuard_CreateMustBePlanned(t *testing.T) {
	env := setupSprintEnv(t)
	r := newSprintRecord(t, env, sprintActive)
	r.Set("start", "2026-09-01 00:00:00.000Z")
	r.Set("end", "2026-09-14 00:00:00.000Z")
	// Even the server may not create an active sprint: starting is a
	// transition with stamps, never a birth state.
	requireRefused(t, saveSprintAsServer(env.app, r), "created as planned")
}

func TestSprintGuard_AClientCannotEditTheState(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")

	fresh, _ := env.app.FindRecordById("boards_sprints", sprint.Id)
	fresh.Set("state", sprintActive)
	fresh.Set("start", "2026-09-01 00:00:00.000Z")
	fresh.Set("end", "2026-09-14 00:00:00.000Z")
	requireRefused(t, env.app.Save(fresh), "started or completed")

	reloaded, _ := env.app.FindRecordById("boards_sprints", sprint.Id)
	if reloaded.GetString("state") != sprintPlanned {
		t.Fatalf("state = %q after a refused edit, want planned", reloaded.GetString("state"))
	}
}

func TestSprintGuard_OnlyMovesForward(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")

	// planned → completed skips a state.
	fresh, _ := env.app.FindRecordById("boards_sprints", sprint.Id)
	fresh.Set("state", sprintCompleted)
	requireRefused(t, saveSprintAsServer(env.app, fresh), "only moves forward")

	advanceSprint(t, env.app, sprint.Id, sprintActive)

	// active → planned goes backwards.
	fresh, _ = env.app.FindRecordById("boards_sprints", sprint.Id)
	fresh.Set("state", sprintPlanned)
	requireRefused(t, saveSprintAsServer(env.app, fresh), "only moves forward")

	advanceSprint(t, env.app, sprint.Id, sprintCompleted)
	reloaded, _ := env.app.FindRecordById("boards_sprints", sprint.Id)
	if reloaded.GetString("state") != sprintCompleted {
		t.Fatalf("state = %q, want completed", reloaded.GetString("state"))
	}
}

func TestSprintGuard_OneActiveSprintPerBoard(t *testing.T) {
	env := setupSprintEnv(t)
	first := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	second := cardsSprint(t, env.app, env.project, "Sprint two", "a1")
	advanceSprint(t, env.app, first.Id, sprintActive)

	fresh, _ := env.app.FindRecordById("boards_sprints", second.Id)
	fresh.Set("state", sprintActive)
	fresh.Set("start", "2026-09-15 00:00:00.000Z")
	fresh.Set("end", "2026-09-28 00:00:00.000Z")
	requireRefused(t, saveSprintAsServer(env.app, fresh), "already active")

	// Completing the first frees the board for the second.
	advanceSprint(t, env.app, first.Id, sprintCompleted)
	advanceSprint(t, env.app, second.Id, sprintActive)
}

// Another BOARD's active sprint is not counted — the invariant is per board.
func TestSprintGuard_ActiveSprintsOnOtherBoardsDoNotCount(t *testing.T) {
	env := setupSprintEnv(t)
	other := cardsProject(t, env.app, "Other", env.owner)
	cardsMember(t, env.app, other, env.owner, "owner")
	theirs := cardsSprint(t, env.app, other, "Their sprint", "a0")
	advanceSprint(t, env.app, theirs.Id, sprintActive)

	mine := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	advanceSprint(t, env.app, mine.Id, sprintActive)
}

func TestSprintGuard_ActiveNeedsBothDates(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")

	fresh, _ := env.app.FindRecordById("boards_sprints", sprint.Id)
	fresh.Set("state", sprintActive)
	fresh.Set("start", "2026-09-01 00:00:00.000Z")
	requireRefused(t, saveSprintAsServer(env.app, fresh), "start and an end date")
}

func TestSprintGuard_EndCannotPrecedeStart(t *testing.T) {
	env := setupSprintEnv(t)
	r := newSprintRecord(t, env, sprintPlanned)
	r.Set("start", "2026-09-14 00:00:00.000Z")
	r.Set("end", "2026-09-01 00:00:00.000Z")
	requireRefused(t, saveSprintAsServer(env.app, r), "cannot end before it starts")
}

func TestSprintGuard_ACardCannotJoinACompletedSprint(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	advanceSprint(t, env.app, sprint.Id, sprintActive)
	advanceSprint(t, env.app, sprint.Id, sprintCompleted)

	card, _ := env.app.FindRecordById("boards_cards", env.card.Id)
	card.Set("sprint", sprint.Id)
	requireRefused(t, env.app.Save(card), "completed")
}

// A card already IN a sprint that then completes stays editable: only a
// CHANGE of sprint is checked, or completing a sprint would freeze every
// card it finished.
func TestSprintGuard_ACardInACompletedSprintStaysEditable(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	advanceSprint(t, env.app, sprint.Id, sprintActive)

	card, _ := env.app.FindRecordById("boards_cards", env.card.Id)
	card.Set("sprint", sprint.Id)
	if err := env.app.Save(card); err != nil {
		t.Fatalf("file card: %v", err)
	}
	advanceSprint(t, env.app, sprint.Id, sprintCompleted)

	card, _ = env.app.FindRecordById("boards_cards", env.card.Id)
	card.Set("title", "renamed after the sprint closed")
	if err := env.app.Save(card); err != nil {
		t.Fatalf("edit a card in a completed sprint: %v", err)
	}
	// And it may leave.
	card, _ = env.app.FindRecordById("boards_cards", env.card.Id)
	card.Set("sprint", "")
	if err := env.app.Save(card); err != nil {
		t.Fatalf("leave a completed sprint: %v", err)
	}
}
