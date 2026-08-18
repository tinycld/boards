package cards

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/automation"
)

// registerAutomation installs cards' owner resolver and the card-completed
// trigger filter. Called from registerShared before hooks load.
func registerAutomation() {
	// One resolver, four triggers: every card event belongs to the same
	// people — the members of the card's board.
	for _, ref := range []string{
		"cards:card-created",
		"cards:card-moved",
		"cards:card-completed",
		"cards:card-assigned",
	} {
		automation.RegisterOwnerResolver(ref, cardOwnerResolver)
	}

	automation.RegisterTriggerFilter("cards:card-completed", cardMovedToDoneList)

	// move-card declares a relation param, and the engine refuses to run an
	// action whose relation param has no registered authorizer — without this
	// the action is greyed out in the catalog and fails at execution.
	automation.RegisterRelationAuthorizer("cards:move-card", "list", moveDestinationAuthorizer)
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

// cardMovedToDoneList is the TriggerFilter for "cards:card-completed".
//
// card-completed and card-moved fire on the same event — a change to the
// card's `list`. What separates them is the DESTINATION list's is_done flag,
// which lives on cards_lists rather than on the card, so a rule condition
// cannot express it: conditions see only the trigger collection's own
// columns. Hence a filter.
//
// Fails closed on an unresolvable list: an unknown destination is not a
// completion, and firing "card completed" on a card that merely moved is the
// worse error.
func cardMovedToDoneList(app core.App, record *core.Record) bool {
	if record == nil {
		return false
	}

	listID := record.GetString("list")
	if listID == "" {
		return false
	}

	list, err := app.FindRecordById("cards_lists", listID)
	if err != nil {
		return false
	}
	return list.GetBool("is_done")
}
