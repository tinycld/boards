package cards

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"tinycld.org/core/automation"
)

// automation_test.go covers cards' automation registrations: the board-
// membership owner resolver shared by all four card triggers, the filter that
// separates card-completed from card-moved, and the native action handlers with
// their relation authorizers.
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

// moveDestinationAuthorizer is what makes cards:move-card runnable at all: the
// engine refuses an action whose relation param has no registered authorizer.
// These cover the two questions the engine's view-rule floor cannot answer —
// may this owner WRITE the board, and is the destination even on it.

func TestMoveDestination_AllowsAWriterMovingWithinTheBoard(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)

	for _, user := range []*core.Record{env.owner, env.member} {
		req := automation.ActionRequest{OwnerID: user.Id, Record: card}
		if err := moveDestinationAuthorizer(env.app, req, env.done.Id); err != nil {
			t.Errorf("a writer must be able to move a card within its board: %v", err)
		}
	}
}

// A card flung onto another board's list keeps its own `project`, so it matches
// neither board's query and disappears from both. Any list the OWNER can see
// would pass the engine's floor, so this has to be checked here.
func TestMoveDestination_RefusesAListOnAnotherBoard(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)

	// A second board the same user owns — so this is refused for being the
	// wrong board, not for being invisible.
	other := cardsProject(t, env.app, "Other board", env.owner)
	cardsMember(t, env.app, other, env.owner, "owner")
	otherList := cardsList(t, env.app, other, "Elsewhere", "a")

	req := automation.ActionRequest{OwnerID: env.owner.Id, Record: card}
	if err := moveDestinationAuthorizer(env.app, req, otherList.Id); err == nil {
		t.Fatal("a destination on a different board must be refused")
	}
}

func TestMoveDestination_RefusesNonWriters(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)

	viewer := cardsUser(t, env.app, "viewer@test.local", "member")
	cardsMember(t, env.app, env.project, viewer, "viewer")
	commentor := cardsUser(t, env.app, "commentor@test.local", "member")
	cardsMember(t, env.app, env.project, commentor, "commentor")

	for _, tc := range []struct {
		name string
		user *core.Record
	}{
		{"viewer", viewer},
		{"commentor", commentor},
		{"outsider", env.outsider},
	} {
		req := automation.ActionRequest{OwnerID: tc.user.Id, Record: card}
		if err := moveDestinationAuthorizer(env.app, req, env.done.Id); err == nil {
			t.Errorf("%s must not be able to move cards", tc.name)
		}
	}
}

func TestMoveDestination_FailsClosedOnMissingInputs(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)

	cases := map[string]automation.ActionRequest{
		"no trigger record": {OwnerID: env.owner.Id, Record: nil},
		"no rule owner":     {OwnerID: "", Record: card},
	}
	for name, req := range cases {
		if err := moveDestinationAuthorizer(env.app, req, env.done.Id); err == nil {
			t.Errorf("%s must fail closed", name)
		}
	}

	// An unresolvable destination is not evidence of permission either.
	req := automation.ActionRequest{OwnerID: env.owner.Id, Record: card}
	if err := moveDestinationAuthorizer(env.app, req, "nonexistentlist"); err == nil {
		t.Error("an unknown destination list must fail closed")
	}
}

// --- cards:add-assignee -----------------------------------------------------
//
// The action's authorization splits across two DIFFERENT questions (see
// assigneeAuthorizer): the rule owner needs board WRITE, the assignee needs only
// board MEMBERSHIP. The viewer cases below pin both directions, because using
// one predicate for both is the easy wrong implementation and it fails silently
// in one direction or the other.

func TestAssigneeAuthorizer_AllowsWriterAssigningMember(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)

	req := automation.ActionRequest{OwnerID: env.owner.Id, Record: card}
	if err := assigneeAuthorizer(env.app, req, env.member.Id); err != nil {
		t.Errorf("owner assigning an editor must be allowed: %v", err)
	}
}

func TestAssigneeAuthorizer_ViewerMayBeAssignedButMayNotAssign(t *testing.T) {
	env := setupCardsAutomation(t)
	viewer := cardsUser(t, env.app, "viewer@test.local", "member")
	cardsMember(t, env.app, env.project, viewer, "viewer")
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)

	// A viewer is a legitimate ASSIGNEE — membership at any role is enough to
	// be given a card, and the app itself allows it.
	asAssignee := automation.ActionRequest{OwnerID: env.owner.Id, Record: card}
	if err := assigneeAuthorizer(env.app, asAssignee, viewer.Id); err != nil {
		t.Errorf("a viewer must be assignable: %v", err)
	}

	// The same viewer as RULE OWNER may not assign: that is a write to the card.
	asOwner := automation.ActionRequest{OwnerID: viewer.Id, Record: card}
	if err := assigneeAuthorizer(env.app, asOwner, env.member.Id); err == nil {
		t.Error("a viewer must not be able to assign cards")
	}
}

func TestAssigneeAuthorizer_RefusesNonMemberAssignee(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)

	// Assigning an outsider would produce a card the assignee cannot see —
	// silently broken rather than visibly refused, which is why this is checked
	// at all: the users view rule passes for every authenticated user, so the
	// engine's own floor establishes nothing here.
	req := automation.ActionRequest{OwnerID: env.owner.Id, Record: card}
	if err := assigneeAuthorizer(env.app, req, env.outsider.Id); err == nil {
		t.Error("assigning a non-member must be refused")
	}
}

func TestAssigneeAuthorizer_FailsClosedOnMissingInputs(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)

	cases := map[string]struct {
		req    automation.ActionRequest
		userID string
	}{
		// Reachable from the builder: attaching this action to a schedule rule.
		"no trigger record": {automation.ActionRequest{OwnerID: env.owner.Id, Record: nil}, env.member.Id},
		"no rule owner":     {automation.ActionRequest{OwnerID: "", Record: card}, env.member.Id},
		"no assignee":       {automation.ActionRequest{OwnerID: env.owner.Id, Record: card}, ""},
		"unknown assignee":  {automation.ActionRequest{OwnerID: env.owner.Id, Record: card}, "nonexistentuser"},
	}
	for name, tc := range cases {
		if err := assigneeAuthorizer(env.app, tc.req, tc.userID); err == nil {
			t.Errorf("%s must fail closed", name)
		}
	}
}

func TestAddAssignee_AppendsWithoutDroppingExisting(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)
	card.Set("assignees", []string{env.owner.Id})
	if err := env.app.Save(card); err != nil {
		t.Fatalf("seed assignee: %v", err)
	}

	req := automation.ActionRequest{
		OwnerID: env.owner.Id,
		Record:  card,
		Params:  map[string]string{"user": env.member.Id},
	}
	if err := addAssignee(env.app, req); err != nil {
		t.Fatalf("add assignee: %v", err)
	}

	got := reloadCard(t, env.app, card.Id).GetStringSlice("assignees")
	// The whole reason this is native: a record-op `set` would replace the slice
	// and drop the owner.
	if len(got) != 2 || !slices.Contains(got, env.owner.Id) || !slices.Contains(got, env.member.Id) {
		t.Errorf("assignees = %v, want both the existing and the new one", got)
	}
}

func TestAddAssignee_AlreadyAssignedIsANoOp(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)
	card.Set("assignees", []string{env.member.Id})
	if err := env.app.Save(card); err != nil {
		t.Fatalf("seed assignee: %v", err)
	}

	// Count real updates rather than comparing `updated`: the seed save and a
	// redundant save land in the same clock tick, so the timestamp is equal
	// either way and such an assertion cannot fail. Asserting "no duplicate id"
	// alone is just as weak — it passes when the handler saves an unchanged
	// record every firing, which still fires cards:card-assigned and burns a
	// chain-depth level. Only counting the write proves the early return.
	var updates int
	env.app.OnRecordUpdate("cards_cards").BindFunc(func(e *core.RecordEvent) error {
		updates++
		return e.Next()
	})

	req := automation.ActionRequest{
		OwnerID: env.owner.Id,
		Record:  card,
		Params:  map[string]string{"user": env.member.Id},
	}
	if err := addAssignee(env.app, req); err != nil {
		t.Fatalf("add assignee: %v", err)
	}

	if got := reloadCard(t, env.app, card.Id).GetStringSlice("assignees"); len(got) != 1 {
		t.Errorf("assignees = %v, want no duplicate", got)
	}
	if updates != 0 {
		t.Errorf("a redundant assign wrote the record %d time(s), want 0", updates)
	}
}

func TestAddAssignee_RefusesBeyondMaxSelect(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)

	full := make([]string, 0, maxRelationValues)
	for i := 0; i < maxRelationValues; i++ {
		u := cardsUser(t, env.app, fmt.Sprintf("filler%d@test.local", i), "member")
		full = append(full, u.Id)
	}
	card.Set("assignees", full)
	if err := env.app.Save(card); err != nil {
		t.Fatalf("seed full assignees: %v", err)
	}

	req := automation.ActionRequest{
		OwnerID: env.owner.Id,
		Record:  card,
		Params:  map[string]string{"user": env.member.Id},
	}
	// Checked in the handler so the message names the cap, rather than surfacing
	// PocketBase's opaque validation error in run history.
	err := addAssignee(env.app, req)
	if err == nil {
		t.Fatal("appending beyond maxSelect must fail")
	}
	if !strings.Contains(err.Error(), "maximum") {
		t.Errorf("error %q should name the cap", err)
	}
}

func TestAddAssignee_FailsClosedOnMissingInputs(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)

	cases := map[string]automation.ActionRequest{
		"no trigger record": {OwnerID: env.owner.Id, Record: nil, Params: map[string]string{"user": env.member.Id}},
		"no assignee param": {OwnerID: env.owner.Id, Record: card, Params: map[string]string{}},
	}
	for name, req := range cases {
		if err := addAssignee(env.app, req); err == nil {
			t.Errorf("%s must fail closed", name)
		}
	}
}

func reloadCard(t *testing.T, app core.App, id string) *core.Record {
	t.Helper()
	rec, err := app.FindRecordById("cards_cards", id)
	if err != nil {
		t.Fatalf("reload card %s: %v", id, err)
	}
	return rec
}

// --- cards:add-label --------------------------------------------------------
//
// Simpler than add-assignee: cards_labels is board-scoped, so asserting the
// label belongs to the card's own board subsumes the separate membership
// question a `users` target needed. The shared append behaviour (idempotency,
// maxSelect, stamping) lives in appendRelation and is covered once under
// add-assignee; these cover what is specific to labels.

func TestLabelAuthorizer_AllowsWriterUsingOwnBoardLabel(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)
	label := cardsLabel(t, env.app, env.project, "Bug", "#ef4444")

	for _, user := range []*core.Record{env.owner, env.member} {
		req := automation.ActionRequest{OwnerID: user.Id, Record: card}
		if err := labelAuthorizer(env.app, req, label.Id); err != nil {
			t.Errorf("a writer must be able to label a card on their board: %v", err)
		}
	}
}

func TestLabelAuthorizer_RefusesLabelFromAnotherBoard(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)

	// A second board the same user owns, so this is refused for being the wrong
	// board rather than for being invisible — the engine's view-rule floor would
	// pass it.
	other := cardsProject(t, env.app, "Other board", env.owner)
	cardsMember(t, env.app, other, env.owner, "owner")
	otherLabel := cardsLabel(t, env.app, other, "Elsewhere", "#8b5cf6")

	req := automation.ActionRequest{OwnerID: env.owner.Id, Record: card}
	if err := labelAuthorizer(env.app, req, otherLabel.Id); err == nil {
		t.Error("a label from a different board must be refused")
	}
}

func TestLabelAuthorizer_RefusesNonWriters(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)
	label := cardsLabel(t, env.app, env.project, "Bug", "#ef4444")

	viewer := cardsUser(t, env.app, "labelviewer@test.local", "member")
	cardsMember(t, env.app, env.project, viewer, "viewer")

	// Unlike an ASSIGNEE — where a viewer is a legitimate target — the rule
	// owner labelling a card is performing a write and needs owner|editor.
	for _, tc := range []struct {
		name string
		user *core.Record
	}{
		{"viewer", viewer},
		{"outsider", env.outsider},
	} {
		req := automation.ActionRequest{OwnerID: tc.user.Id, Record: card}
		if err := labelAuthorizer(env.app, req, label.Id); err == nil {
			t.Errorf("%s must not be able to label cards", tc.name)
		}
	}
}

func TestLabelAuthorizer_FailsClosedOnMissingInputs(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)
	label := cardsLabel(t, env.app, env.project, "Bug", "#ef4444")

	cases := map[string]struct {
		req     automation.ActionRequest
		labelID string
	}{
		"no trigger record": {automation.ActionRequest{OwnerID: env.owner.Id, Record: nil}, label.Id},
		"no rule owner":     {automation.ActionRequest{OwnerID: "", Record: card}, label.Id},
		"unknown label":     {automation.ActionRequest{OwnerID: env.owner.Id, Record: card}, "nonexistentlabel"},
	}
	for name, tc := range cases {
		if err := labelAuthorizer(env.app, tc.req, tc.labelID); err == nil {
			t.Errorf("%s must fail closed", name)
		}
	}
}

func TestAddLabel_AppendsWithoutDroppingExisting(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)
	first := cardsLabel(t, env.app, env.project, "Bug", "#ef4444")
	second := cardsLabel(t, env.app, env.project, "Urgent", "#f59e0b")

	card.Set("labels", []string{first.Id})
	if err := env.app.Save(card); err != nil {
		t.Fatalf("seed label: %v", err)
	}

	req := automation.ActionRequest{
		OwnerID: env.owner.Id,
		Record:  card,
		Params:  map[string]string{"label": second.Id},
	}
	if err := addLabel(env.app, req); err != nil {
		t.Fatalf("add label: %v", err)
	}

	got := reloadCard(t, env.app, card.Id).GetStringSlice("labels")
	if len(got) != 2 || !slices.Contains(got, first.Id) || !slices.Contains(got, second.Id) {
		t.Errorf("labels = %v, want both the existing and the new one", got)
	}
}

func TestAddLabel_AlreadyPresentIsANoOp(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Ship it", "a", env.owner)
	label := cardsLabel(t, env.app, env.project, "Bug", "#ef4444")

	card.Set("labels", []string{label.Id})
	if err := env.app.Save(card); err != nil {
		t.Fatalf("seed label: %v", err)
	}

	var updates int
	env.app.OnRecordUpdate("cards_cards").BindFunc(func(e *core.RecordEvent) error {
		updates++
		return e.Next()
	})

	req := automation.ActionRequest{
		OwnerID: env.owner.Id,
		Record:  card,
		Params:  map[string]string{"label": label.Id},
	}
	if err := addLabel(env.app, req); err != nil {
		t.Fatalf("add label: %v", err)
	}

	if got := reloadCard(t, env.app, card.Id).GetStringSlice("labels"); len(got) != 1 {
		t.Errorf("labels = %v, want no duplicate", got)
	}
	if updates != 0 {
		t.Errorf("a redundant label wrote the record %d time(s), want 0", updates)
	}
}
