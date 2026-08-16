package cards

import (
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
