package boards

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/automation"
)

// The sprint half of the automation surface: the set-sprint authorizer, the
// native add-to-active-sprint, and the two transition filters.

func automationSprint(t *testing.T, env *cardsAutomationEnv, name, position string) *core.Record {
	t.Helper()
	return cardsSprint(t, env.app, env.project, name, position)
}

func TestSprintAuthorizer_AllowsAWriterFilingOnTheBoard(t *testing.T) {
	env := setupCardsAutomation(t)
	registerSprintGuard(env.app)
	sprint := automationSprint(t, env, "Sprint one", "a0")
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)

	req := automation.ActionRequest{OwnerID: env.member.Id, Record: card}
	if err := sprintAuthorizer(env.app, req, sprint.Id); err != nil {
		t.Fatalf("editor filing on own board: %v", err)
	}
}

func TestSprintAuthorizer_RefusesAnotherBoardsSprintAndACompletedOne(t *testing.T) {
	env := setupCardsAutomation(t)
	registerSprintGuard(env.app)
	registerSprintOwnedColumns(env.app)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)
	req := automation.ActionRequest{OwnerID: env.owner.Id, Record: card}

	other := cardsProject(t, env.app, "Other", env.owner)
	cardsMember(t, env.app, other, env.owner, "owner")
	foreign := cardsSprint(t, env.app, other, "Theirs", "a0")
	if err := sprintAuthorizer(env.app, req, foreign.Id); err == nil {
		t.Fatal("a sprint on another board was allowed")
	}

	closed := automationSprint(t, env, "Closed", "a0")
	advanceSprint(t, env.app, closed.Id, sprintActive)
	advanceSprint(t, env.app, closed.Id, sprintCompleted)
	if err := sprintAuthorizer(env.app, req, closed.Id); err == nil {
		t.Fatal("a completed sprint was allowed")
	}
}

func TestSprintAuthorizer_FailsClosedOnMissingInputs(t *testing.T) {
	env := setupCardsAutomation(t)
	if err := sprintAuthorizer(env.app, automation.ActionRequest{OwnerID: env.owner.Id}, "any"); err == nil {
		t.Fatal("no trigger record was allowed")
	}
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)
	req := automation.ActionRequest{OwnerID: env.outsider.Id, Record: card}
	sprint := automationSprint(t, env, "Sprint one", "a0")
	if err := sprintAuthorizer(env.app, req, sprint.Id); err == nil {
		t.Fatal("a non-member rule owner was allowed")
	}
}

func TestAddToActiveSprint_FilesIntoTheActiveSprint(t *testing.T) {
	env := setupCardsAutomation(t)
	registerSprintGuard(env.app)
	registerSprintOwnedColumns(env.app)
	sprint := automationSprint(t, env, "Sprint one", "a0")
	advanceSprint(t, env.app, sprint.Id, sprintActive)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)

	req := automation.ActionRequest{OwnerID: env.owner.Id, Record: card}
	if err := addToActiveSprint(env.app, req); err != nil {
		t.Fatalf("add to active sprint: %v", err)
	}
	requireCardSprint(card.Id, sprint.Id)(t, env.app)
}

// No active sprint is a no-op, not a failure: the rule must not error
// between sprints.
func TestAddToActiveSprint_NoActiveSprintIsANoOp(t *testing.T) {
	env := setupCardsAutomation(t)
	automationSprint(t, env, "Planned", "a0")
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)

	req := automation.ActionRequest{OwnerID: env.owner.Id, Record: card}
	if err := addToActiveSprint(env.app, req); err != nil {
		t.Fatalf("no active sprint should be a no-op: %v", err)
	}
	requireCardSprint(card.Id, "")(t, env.app)
}

func TestAddToActiveSprint_RefusesNonWriters(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)
	req := automation.ActionRequest{OwnerID: env.outsider.Id, Record: card}
	if err := addToActiveSprint(env.app, req); err == nil {
		t.Fatal("a non-member rule owner filed a card")
	}
}

func TestSprintTransitionFilters(t *testing.T) {
	env := setupCardsAutomation(t)
	registerSprintGuard(env.app)
	registerSprintOwnedColumns(env.app)
	sprint := automationSprint(t, env, "Sprint one", "a0")

	// Loaded, then set without saving: Original() is the stored row, the
	// shape the after-save hook hands a filter.
	fresh, _ := env.app.FindRecordById("boards_sprints", sprint.Id)
	fresh.Set("state", sprintActive)
	if !sprintBecameActive(env.app, fresh) {
		t.Fatal("planned → active must fire sprint-started")
	}
	if sprintBecameCompleted(env.app, fresh) {
		t.Fatal("planned → active must not fire sprint-completed")
	}
	if !automation.WatchChanged(fresh, []string{"state"}) {
		t.Fatal("the transition must read as a change to the watched column")
	}

	advanceSprint(t, env.app, sprint.Id, sprintActive)
	fresh, _ = env.app.FindRecordById("boards_sprints", sprint.Id)
	fresh.Set("state", sprintCompleted)
	if !sprintBecameCompleted(env.app, fresh) {
		t.Fatal("active → completed must fire sprint-completed")
	}

	// A same-state re-save fires neither.
	same, _ := env.app.FindRecordById("boards_sprints", sprint.Id)
	same.Set("goal", "renamed")
	if sprintBecameActive(env.app, same) || sprintBecameCompleted(env.app, same) {
		t.Fatal("an edit that keeps the state fired a transition")
	}
	if sprintBecameActive(env.app, nil) {
		t.Fatal("a nil record fired")
	}
}
