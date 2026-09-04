package cards

import (
	"fmt"
	"slices"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/automation"
)

// registerAutomation installs cards' automation surface: the owner resolver
// shared by every cards trigger, the trigger filters that split one record
// event into its named cases, and the native action handlers with the
// relation authorizers the engine requires before it will run them. Called
// from registerShared before hooks load.
func registerAutomation() {
	// One resolver, every trigger: a card event — and a reaction on one of
	// its comments — belongs to the same people, the members of the card's
	// board. cardOwnerResolver reads `project`, which every row here carries.
	for _, ref := range []string{
		"cards:card-created",
		"cards:card-moved",
		"cards:card-completed",
		"cards:card-canceled",
		"cards:card-assigned",
		"cards:card-priority-changed",
		"cards:card-estimate-changed",
		"cards:card-rescheduled",
		"cards:card-archived",
		"cards:card-parented",
		"cards:comment-reacted",
	} {
		automation.RegisterOwnerResolver(ref, cardOwnerResolver)
	}

	automation.RegisterTriggerFilter("cards:card-completed", cardMovedToDoneList)
	automation.RegisterTriggerFilter("cards:card-canceled", cardMovedToCanceledList)
	// `archived` flips both ways; only the archive is the event. A restore is
	// visible in history and to watchers, but "a card is archived" firing on
	// a restore would be the wrong surprise.
	automation.RegisterTriggerFilter("cards:card-archived", cardIsArchived)

	// move-card declares a relation param, and the engine refuses to run an
	// action whose relation param has no registered authorizer — without this
	// the action is greyed out in the catalog and fails at execution.
	automation.RegisterRelationAuthorizer("cards:move-card", "list", moveDestinationAuthorizer)
	// set-parent is a record-op like move-card — a single-valued relation, so
	// `set` is the right verb — and needs an authorizer for the same reason.
	automation.RegisterRelationAuthorizer("cards:set-parent", "parent", parentAuthorizer)

	automation.RegisterAction("cards:add-assignee", addAssignee)
	automation.RegisterRelationAuthorizer("cards:add-assignee", "user", assigneeAuthorizer)

	automation.RegisterAction("cards:add-label", addLabel)
	automation.RegisterRelationAuthorizer("cards:add-label", "label", labelAuthorizer)
}

// maxRelationValues mirrors the maxSelect on cards_cards' `assignees` and
// `labels` (both 20, migration 1980000000). Checked in the handlers so an
// over-cap append fails with a message naming the cap, rather than as
// PocketBase's opaque validation error in run history.
const maxRelationValues = 20

// assigneeAuthorizer answers the which-record question for cards:add-assignee's
// `user` param.
//
// This action has the weakest engine-supplied guarantees of cards' set, because
// its relation target is `users`: EVERY authenticated user passes the users view
// rule, so the engine's floor establishes nothing here. Compare move-card, whose
// cards_lists target means the floor has already proven board visibility. All of
// the authorization below is therefore ours to do.
//
// Two DIFFERENT questions, which is why this does not just call checkBoardWrite
// twice:
//
//   - The rule OWNER must be able to write the board (owner|editor). Assigning
//     is a write to the card.
//   - The ASSIGNEE need only be a MEMBER, at any role. A viewer can legitimately
//     be assigned a card; requiring write access here would refuse a case the
//     app itself allows.
//
// The membership requirement is not extra strictness: the board UI only ever
// offers board members (BoardCard.tsx renders BoardMember), so assigning an
// outsider produces a card the assignee cannot see — a silently broken state
// rather than a visible error.
//
// Fails closed on anything unresolvable, per moveDestinationAuthorizer: an
// unreadable membership row is not evidence of permission.
func assigneeAuthorizer(app core.App, req automation.ActionRequest, userID string) error {
	// Nothing stops a user attaching this action to a core:schedule rule, which
	// has no trigger record. A builder-reachable misconfiguration, not an
	// impossible state — so it gets a message that reads as one in run history.
	if req.Record == nil {
		return fmt.Errorf("cards:add-assignee needs a card to assign — attach it to a card trigger, not a schedule")
	}
	projectID := req.Record.GetString("project")
	if projectID == "" {
		return fmt.Errorf("card %s has no board", req.Record.Id)
	}
	if err := checkBoardWrite(app, req.OwnerID, projectID); err != nil {
		return err
	}
	return checkBoardMembership(app, userID, projectID)
}

// checkBoardMembership reports whether a user belongs to a board at ANY role.
// Distinct from checkBoardWrite, which additionally requires owner|editor — see
// assigneeAuthorizer for why being assignable and being able to write are not
// the same question.
func checkBoardMembership(app core.App, userID, projectID string) error {
	if userID == "" {
		return fmt.Errorf("no user to assign")
	}
	members, err := app.FindRecordsByFilter(
		"cards_project_members",
		"project = {:project} && user = {:user}",
		"", 1, 0,
		map[string]any{"project": projectID, "user": userID},
	)
	if err != nil {
		return fmt.Errorf("membership lookup for board %s: %w", projectID, err)
	}
	if len(members) != 1 {
		return fmt.Errorf("user %s is not a member of board %s", userID, projectID)
	}
	return nil
}

// labelAuthorizer answers the which-record question for cards:add-label's
// `label` param.
//
// Simpler than assigneeAuthorizer in one respect: cards_labels rows are
// board-scoped (cards_labels.project), so the engine's view-rule floor already
// carries real information, and asserting the label belongs to the card's own
// board subsumes the separate "is it a member" question that a users target
// required. A label from another board is the same cross-board leak
// moveDestinationAuthorizer refuses for lists.
func labelAuthorizer(app core.App, req automation.ActionRequest, labelID string) error {
	if req.Record == nil {
		return fmt.Errorf("cards:add-label needs a card to label — attach it to a card trigger, not a schedule")
	}
	projectID := req.Record.GetString("project")
	if projectID == "" {
		return fmt.Errorf("card %s has no board", req.Record.Id)
	}
	label, err := app.FindRecordById("cards_labels", labelID)
	if err != nil {
		return fmt.Errorf("label %s: %w", labelID, err)
	}
	if label.GetString("project") != projectID {
		return fmt.Errorf("label %s is on a different board than the card", labelID)
	}
	return checkBoardWrite(app, req.OwnerID, projectID)
}

// addAssignee appends one user to the trigger card's assignees.
//
// Authorization lives in assigneeAuthorizer, which the engine runs before this
// — the engine refuses the action outright if that authorizer is unregistered,
// so this handler validates only that the write itself is coherent.
func addAssignee(app core.App, req automation.ActionRequest) error {
	return appendRelation(app, req, "cards:add-assignee", "assignees", req.Params["user"])
}

// addLabel appends one label to the trigger card's labels. Authorization lives
// in labelAuthorizer; see addAssignee.
func addLabel(app core.App, req automation.ActionRequest) error {
	return appendRelation(app, req, "cards:add-label", "labels", req.Params["label"])
}

// appendRelation adds one id to a multi-value relation on the trigger card.
//
// Shared by add-assignee and add-label, which differ only in the column they
// append to and the authorizer the engine ran before them: both must append
// rather than replace (a record-op `set` would drop the existing values), both
// must be idempotent, and both must respect maxSelect.
func appendRelation(app core.App, req automation.ActionRequest, ref, field, id string) error {
	if req.Record == nil {
		return fmt.Errorf("%s needs a card", ref)
	}
	if id == "" {
		return fmt.Errorf("%s: nothing to add", ref)
	}

	card, err := app.FindRecordById("cards_cards", req.Record.Id)
	if err != nil {
		return fmt.Errorf("load card %s: %w", req.Record.Id, err)
	}

	current := card.GetStringSlice(field)
	if slices.Contains(current, id) {
		// Already present: return without saving. An unchanged Save still fires
		// the card's update triggers and burns a chain-depth level, so a rule
		// that re-matches would churn for no visible effect.
		return nil
	}
	if len(current) >= maxRelationValues {
		return fmt.Errorf("card %s already has the maximum %d %s", card.Id, maxRelationValues, field)
	}

	card.Set(field, append(current, id))

	// cards:card-assigned watches `assignees`, so this write re-enters the
	// engine. Unstamped it would arrive as an ordinary user edit at depth 0 —
	// the depth cap only ever sees the stamp, so without this the chain never
	// terminates. `labels` is watched by no trigger today, but stamping is
	// unconditional on purpose: that is a property of the current catalog, and a
	// later card-labeled trigger would otherwise reopen the loop silently.
	return automation.MarkEngineWrite(req, card.Id, func() error {
		return app.Save(card)
	})
}

// moveDestinationAuthorizer answers the which-record question for
// cards:move-card's `list` param: the destination must be a list on the SAME
// board as the card, and the rule owner must be able to write that board.
//
// The engine's floor has already proven the owner can VIEW the destination
// list, which is not enough on either axis:
//
//   - Visibility is not writability. A card's collection rule requires the
//     owner|editor roles (`viaWriter` in 1980000000); a viewer or commentor
//     passes the list's view rule but may not move cards. The engine's
//     superuser Save would otherwise do it anyway — the same bug shape the
//     calendar rollout shipped.
//   - Any list the owner can see would do. A rule owner who belongs to two
//     boards can see both boards' lists, so an unconstrained param lets a rule
//     fling a card out of its own board into an unrelated one, where the
//     card's `project` no longer matches its `list`. The board query joins on
//     project, so the card simply vanishes from both.
//
// Fails closed on anything unresolvable: an unknown destination or an
// unreadable membership is not evidence of permission.
func moveDestinationAuthorizer(app core.App, req automation.ActionRequest, destID string) error {
	if req.Record == nil {
		return fmt.Errorf("cards:move-card: no trigger card to move")
	}
	dest, err := app.FindRecordById("cards_lists", destID)
	if err != nil {
		return fmt.Errorf("destination list %s: %w", destID, err)
	}
	projectID := req.Record.GetString("project")
	if projectID == "" || dest.GetString("project") != projectID {
		return fmt.Errorf(
			"destination list %s is on a different board than the card", destID)
	}
	return checkBoardWrite(app, req.OwnerID, projectID)
}

// parentAuthorizer answers the which-record question for cards:set-parent's
// `parent` param. moveDestinationAuthorizer's shape, reading cards_cards
// instead of cards_lists, and for the same two reasons — visibility is not
// writability, and any card the owner can see would otherwise do.
//
// The third check has no analogue there and is the one this feature turns on:
// the parent must not itself be a sub-task. The engine saves as a superuser
// and so bypasses the rules AND the OnRecordUpdate guard's siblings, which
// makes this the only place a rule-driven set-parent can be stopped from
// building a three-level tree. (checkParent still runs — it is bound on the
// model hook, not the request hook — but refusing here names the rule and the
// param in the error the user reads.)
//
// Fails closed on anything unresolvable.
func parentAuthorizer(app core.App, req automation.ActionRequest, parentID string) error {
	if req.Record == nil {
		return fmt.Errorf("cards:set-parent: no trigger card to re-parent")
	}
	if parentID == req.Record.Id {
		return fmt.Errorf("a card cannot be its own sub-task")
	}
	parent, err := app.FindRecordById("cards_cards", parentID)
	if err != nil {
		return fmt.Errorf("parent card %s: %w", parentID, err)
	}
	projectID := req.Record.GetString("project")
	if projectID == "" || parent.GetString("project") != projectID {
		return fmt.Errorf("parent card %s is on a different board than the card", parentID)
	}
	if parent.GetString("parent") != "" {
		return fmt.Errorf("parent card %s is itself a sub-task", parentID)
	}
	return checkBoardWrite(app, req.OwnerID, projectID)
}

// checkBoardWrite reports whether a user may write this board's cards. The
// roles mirror cards_cards' own updateRule (`viaWriter`, 1980000000) and
// lib/permissions.ts: owner and editor write; commentor and viewer do not.
func checkBoardWrite(app core.App, userID, projectID string) error {
	if userID == "" {
		return fmt.Errorf("no rule owner to authorize the move as")
	}
	members, err := app.FindRecordsByFilter(
		"cards_project_members",
		"project = {:project} && user = {:user}",
		"", 1, 0,
		map[string]any{"project": projectID, "user": userID},
	)
	if err != nil {
		return fmt.Errorf("membership lookup for board %s: %w", projectID, err)
	}
	if len(members) != 1 {
		return fmt.Errorf("rule owner is not a member of board %s", projectID)
	}
	if role := members[0].GetString("role"); role != "owner" && role != "editor" {
		return fmt.Errorf("rule owner's role %q may not move cards on board %s", role, projectID)
	}
	return nil
}

// cardOwnerResolver maps a cards_cards row to the users the card belongs to:
// every member of its board.
//
// cards_cards has created_by, but auto-detection does not look for it — and
// declaring it as an ownerField would be wrong anyway. It scopes a personal
// rule to whoever created the card, so a colleague moving your card would
// never fire your rule. Membership is the honest answer.
//
// Returns nil (never an error) on absent or malformed data so org-scoped rules
// still fire when no personal owner can be determined — the same contract
// mail's, calendar's and text's resolvers follow.
func cardOwnerResolver(app core.App, record *core.Record) []string {
	if record == nil {
		return nil
	}

	projectID := record.GetString("project")
	if projectID == "" {
		return nil
	}

	members, err := app.FindRecordsByFilter(
		"cards_project_members",
		"project = {:project}",
		"",
		0,
		0,
		map[string]any{"project": projectID},
	)
	if err != nil || len(members) == 0 {
		return nil
	}

	var owners []string
	for _, member := range members {
		if userID := member.GetString("user"); userID != "" {
			owners = append(owners, userID)
		}
	}
	return owners
}

// listCategory reads a list's status category. ” — a row written before the
// column existed, or by a client that omitted it — reads as `todo`, exactly
// as lib/list-category.ts normalizes it, so the two sides never disagree
// about what an unmarked list is.
func listCategory(list *core.Record) string {
	if category := list.GetString("category"); category != "" {
		return category
	}
	return "todo"
}

// cardListCategory resolves the category of the list a card sits in.
//
// Fails closed (ok = false) on a nil record, a blank list, or a list that
// cannot be loaded: an unknown destination is neither done nor canceled, and
// firing "card completed" on a card that merely moved is the worse error.
func cardListCategory(app core.App, record *core.Record) (category string, ok bool) {
	if record == nil {
		return "", false
	}
	listID := record.GetString("list")
	if listID == "" {
		return "", false
	}
	list, err := app.FindRecordById("cards_lists", listID)
	if err != nil {
		return "", false
	}
	return listCategory(list), true
}

// cardMovedToDoneList is the TriggerFilter for "cards:card-completed".
//
// card-completed and card-moved fire on the same event — a change to the
// card's `list`. What separates them is the DESTINATION list's category,
// which lives on cards_lists rather than on the card, so a rule condition
// cannot express it: conditions see only the trigger collection's own
// columns. Hence a filter. Only `done` counts: a canceled list is closed, but
// it is not a completion — that is cardMovedToCanceledList's event.
func cardMovedToDoneList(app core.App, record *core.Record) bool {
	category, ok := cardListCategory(app, record)
	return ok && category == "done"
}

// cardMovedToCanceledList is the TriggerFilter for "cards:card-canceled".
func cardMovedToCanceledList(app core.App, record *core.Record) bool {
	category, ok := cardListCategory(app, record)
	return ok && category == "canceled"
}

// cardIsArchived is the TriggerFilter for "cards:card-archived": the watched
// column flipped, and it flipped TO archived. The auto-archive sweep's saves
// pass through here at depth 0 like any other, which is intended — a rule
// that says "when a card is archived, tell the team" should hear about the
// sweep's archives too.
func cardIsArchived(_ core.App, record *core.Record) bool {
	return record != nil && record.GetBool("archived")
}

// cardInClosedList: the card's work has stopped, one way or the other. What
// the due-date reminders and the auto-archive sweep ask.
func cardInClosedList(app core.App, record *core.Record) bool {
	category, ok := cardListCategory(app, record)
	return ok && (category == "done" || category == "canceled")
}
