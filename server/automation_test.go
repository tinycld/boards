package cards

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// automation_test.go covers cards' two registrations: the board-membership
// owner resolver shared by all four card triggers, and the filter that
// separates card-completed from card-moved.
//
// Run against the package's real migrations (newCardsApp / rlstest), because
// both answers are only correct relative to the actual schema — is_done lives
// on cards_lists, and membership on cards_project_members.

type cardsAutomationEnv struct {
	app      *tests.TestApp
	owner    *core.Record
	member   *core.Record
	outsider *core.Record
	project  *core.Record
	todo     *core.Record
	done     *core.Record
}

func setupCardsAutomation(t *testing.T) *cardsAutomationEnv {
	t.Helper()
	app := newCardsApp(t)

	owner := cardsUser(t, app, "owner@test.local", "member")
	member := cardsUser(t, app, "member@test.local", "member")
	outsider := cardsUser(t, app, "outsider@test.local", "member")

	project := cardsProject(t, app, "Board", owner)
	cardsMember(t, app, project, owner, "owner")
	cardsMember(t, app, project, member, "editor")

	todo := cardsList(t, app, project, "To do", "a")
	done := cardsList(t, app, project, "Done", "b")
	done.Set("is_done", true)
	if err := app.Save(done); err != nil {
		t.Fatalf("mark list done: %v", err)
	}

	return &cardsAutomationEnv{
		app: app, owner: owner, member: member, outsider: outsider,
		project: project, todo: todo, done: done,
	}
}

func TestCardOwnerResolver_ResolvesBoardMembers(t *testing.T) {
	env := setupCardsAutomation(t)
	// Created by the owner, but every board member's rules should fire —
	// which is the whole reason this isn't created_by.
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)

	owners := cardOwnerResolver(env.app, card)

	got := map[string]bool{}
	for _, id := range owners {
		got[id] = true
	}
	if !got[env.owner.Id] {
		t.Errorf("board owner %s missing from %v", env.owner.Id, owners)
	}
	if !got[env.member.Id] {
		t.Errorf("board member %s missing from %v", env.member.Id, owners)
	}
	if got[env.outsider.Id] {
		t.Errorf("outsider %s must not be an owner: %v", env.outsider.Id, owners)
	}
}

// The bug this avoids: created_by would return only the card's creator, so a
// colleague moving your card would never fire your rule.
func TestCardOwnerResolver_IsNotJustTheCreator(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)

	if owners := cardOwnerResolver(env.app, card); len(owners) < 2 {
		t.Fatalf("owners = %v, want every board member, not just the creator", owners)
	}
}

func TestCardOwnerResolver_MalformedRecordsResolveNil(t *testing.T) {
	env := setupCardsAutomation(t)

	if owners := cardOwnerResolver(env.app, nil); owners != nil {
		t.Errorf("nil record: got %v, want nil", owners)
	}

	col, err := env.app.FindCollectionByNameOrId("cards_cards")
	if err != nil {
		t.Fatal(err)
	}
	orphan := core.NewRecord(col)
	orphan.Set("title", "no board")
	orphan.Set("list", env.todo.Id)
	orphan.Set("position", "a")
	orphan.Set("created_by", env.owner.Id)
	// Skip validation: the fixture's point is a missing project, which the
	// relation's required check would reject.
	if err := env.app.SaveNoValidate(orphan); err != nil {
		t.Fatalf("save orphan card: %v", err)
	}

	if owners := cardOwnerResolver(env.app, orphan); owners != nil {
		t.Errorf("card with no project: got %v, want nil", owners)
	}
}

// card-completed and card-moved fire on the SAME event. What separates them is
// the destination list's is_done flag — which lives on cards_lists, so a rule
// condition could never express it.
func TestCardMovedToDoneList(t *testing.T) {
	env := setupCardsAutomation(t)

	inDone := cardsCard(t, env.app, env.project, env.done, "Finished", "a", env.owner)
	if !cardMovedToDoneList(env.app, inDone) {
		t.Error("a card in a list marked done must be admitted as completed")
	}

	inTodo := cardsCard(t, env.app, env.project, env.todo, "Ongoing", "b", env.owner)
	if cardMovedToDoneList(env.app, inTodo) {
		t.Error("a card in an ordinary list must NOT be treated as completed")
	}

	if cardMovedToDoneList(env.app, nil) {
		t.Error("a nil record must not be treated as completed")
	}
}

// Fails closed: an unresolvable destination is not a completion, and firing
// "card completed" on a card that merely moved is the worse error.
func TestCardMovedToDoneList_UnresolvableListFailsClosed(t *testing.T) {
	env := setupCardsAutomation(t)

	col, err := env.app.FindCollectionByNameOrId("cards_cards")
	if err != nil {
		t.Fatal(err)
	}
	card := core.NewRecord(col)
	card.Set("project", env.project.Id)
	card.Set("title", "dangling list")
	card.Set("position", "z")
	card.Set("created_by", env.owner.Id)
	card.Set("list", "nonexistentlist")
	if err := env.app.SaveNoValidate(card); err != nil {
		t.Fatalf("save card with dangling list: %v", err)
	}

	if cardMovedToDoneList(env.app, card) {
		t.Error("an unresolvable destination list must not read as completed")
	}
}
