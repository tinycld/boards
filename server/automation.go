package boards

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/automation"
)

// registerAutomation installs boards' automation surface: the owner resolver
// shared by every boards trigger, the trigger filters that split one record
// event into its named cases, and the native action handlers with the
// relation authorizers the engine requires before it will run them. Called
// from registerShared before hooks load.
func registerAutomation() {
	// One resolver, every trigger: a card event — and a reaction on one of
	// its comments — belongs to the same people, the members of the card's
	// board. cardOwnerResolver reads `project`, which every row here carries.
	for _, ref := range []string{
		"boards:card-created",
		"boards:card-moved",
		"boards:card-completed",
		"boards:card-canceled",
		"boards:card-assigned",
		"boards:card-priority-changed",
		"boards:card-estimate-changed",
		"boards:card-rescheduled",
		"boards:card-overdue",
		"boards:card-due-soon",
		"boards:card-archived",
		"boards:card-parented",
		"boards:comment-reacted",
	} {
		automation.RegisterOwnerResolver(ref, cardOwnerResolver)
	}

	automation.RegisterTriggerFilter("boards:card-completed", cardMovedToDoneList)
	automation.RegisterTriggerFilter("boards:card-canceled", cardMovedToCanceledList)
	// `archived` flips both ways; only the archive is the event. A restore is
	// visible in history and to watchers, but "a card is archived" firing on
	// a restore would be the wrong surprise.
	automation.RegisterTriggerFilter("boards:card-archived", cardIsArchived)
	// Both deadline triggers watch a stamp column, which moves in BOTH
	// directions: the sweep sets it, and rescheduling a card clears it
	// (registerDueNotices). Only the set is the event.
	automation.RegisterTriggerFilter("boards:card-overdue", cardBecameOverdue)
	automation.RegisterTriggerFilter("boards:card-due-soon", cardBecameDueSoon)

	// move-card declares a relation param, and the engine refuses to run an
	// action whose relation param has no registered authorizer — without this
	// the action is greyed out in the catalog and fails at execution.
	automation.RegisterRelationAuthorizer("boards:move-card", "list", moveDestinationAuthorizer)
	// set-parent is a record-op like move-card — a single-valued relation, so
	// `set` is the right verb — and needs an authorizer for the same reason.
	automation.RegisterRelationAuthorizer("boards:set-parent", "parent", parentAuthorizer)

	automation.RegisterAction("boards:add-assignee", addAssignee)
	automation.RegisterRelationAuthorizer("boards:add-assignee", "user", assigneeAuthorizer)

	automation.RegisterAction("boards:add-label", addLabel)
	automation.RegisterRelationAuthorizer("boards:add-label", "label", labelAuthorizer)

	// create-card must be native: a record-op `create` cannot derive `project`
	// from the chosen list, and the two disagreeing makes the card invisible.
	automation.RegisterAction("boards:create-card", createCard)
	automation.RegisterRelationAuthorizer("boards:create-card", "list", createCardListAuthorizer)

	// set-due-date must be native for the date math; it declares no relation
	// param, so it needs no authorizer — it checks board write itself.
	automation.RegisterAction("boards:set-due-date", setDueDate)
}

// maxDueShiftDays bounds boards:set-due-date. A rule that re-fires on its own
// write is already stopped by the chain-depth cap, so this is not a loop
// guard: it is what keeps a typo'd offset from parking a card centuries out,
// where every date reader (the sweep's filter, the timeline axis) still has to
// cope with it. Ten years is far past any real deadline and far short of that.
const maxDueShiftDays = 3650

// cardTitleRuneLimit is boards_cards.title's own `max` (migration 1980000000).
// Truncating to it rather than letting the save fail is what makes a rule's
// title safe as a TEMPLATE: {{description}} can expand well past anything
// anyone typed into the action, and a rule that dies in run history on a long
// description is a worse answer than a clipped title.
//
// Counted in RUNES while the column's max is counted by PocketBase in the same
// unit, so a multi-byte title clips where the validator would object and not
// somewhere earlier.
const cardTitleRuneLimit = 500

// maxRelationValues mirrors the maxSelect on boards_cards' `assignees` and
// `labels` (both 20, migration 1980000000). Checked in the handlers so an
// over-cap append fails with a message naming the cap, rather than as
// PocketBase's opaque validation error in run history.
const maxRelationValues = 20

// assigneeAuthorizer answers the which-record question for boards:add-assignee's
// `user` param.
//
// This action has the weakest engine-supplied guarantees of boards' set, because
// its relation target is `users`: EVERY authenticated user passes the users view
// rule, so the engine's floor establishes nothing here. Compare move-card, whose
// boards_lists target means the floor has already proven board visibility. All of
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
		return fmt.Errorf("boards:add-assignee needs a card to assign — attach it to a card trigger, not a schedule")
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
		"boards_project_members",
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

// labelAuthorizer answers the which-record question for boards:add-label's
// `label` param.
//
// Simpler than assigneeAuthorizer in one respect: boards_labels rows are
// board-scoped (boards_labels.project), so the engine's view-rule floor already
// carries real information, and asserting the label belongs to the card's own
// board subsumes the separate "is it a member" question that a users target
// required. A label from another board is the same cross-board leak
// moveDestinationAuthorizer refuses for lists.
func labelAuthorizer(app core.App, req automation.ActionRequest, labelID string) error {
	if req.Record == nil {
		return fmt.Errorf("boards:add-label needs a card to label — attach it to a card trigger, not a schedule")
	}
	projectID := req.Record.GetString("project")
	if projectID == "" {
		return fmt.Errorf("card %s has no board", req.Record.Id)
	}
	label, err := app.FindRecordById("boards_labels", labelID)
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
	return appendRelation(app, req, "boards:add-assignee", "assignees", req.Params["user"])
}

// addLabel appends one label to the trigger card's labels. Authorization lives
// in labelAuthorizer; see addAssignee.
func addLabel(app core.App, req automation.ActionRequest) error {
	return appendRelation(app, req, "boards:add-label", "labels", req.Params["label"])
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

	card, err := app.FindRecordById("boards_cards", req.Record.Id)
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

	// boards:card-assigned watches `assignees`, so this write re-enters the
	// engine. Unstamped it would arrive as an ordinary user edit at depth 0 —
	// the depth cap only ever sees the stamp, so without this the chain never
	// terminates. `labels` is watched by no trigger today, but stamping is
	// unconditional on purpose: that is a property of the current catalog, and a
	// later card-labeled trigger would otherwise reopen the loop silently.
	return automation.MarkEngineWrite(req, card.Id, func() error {
		return app.Save(card)
	})
}

// createCardListAuthorizer answers the which-record question for
// boards:create-card's `list` param.
//
// Unlike every other authorizer here, this one does NOT compare against the
// trigger card's board: the whole point of the action is to create a card
// somewhere, and that somewhere is legitimately another board — "when a bug is
// filed, open a QA task on the QA board" is the motivating rule. What keeps
// that from being an escape hatch is the write check: the rule owner must be
// able to write the DESTINATION board, so a rule can only create cards where
// its owner could have created one by hand.
//
// It therefore does not require req.Record at all, which is deliberate — the
// action is meaningful on a trigger whose record is not a card.
//
// Fails closed on anything unresolvable, per moveDestinationAuthorizer.
func createCardListAuthorizer(app core.App, req automation.ActionRequest, listID string) error {
	list, err := app.FindRecordById("boards_lists", listID)
	if err != nil {
		return fmt.Errorf("destination list %s: %w", listID, err)
	}
	projectID := list.GetString("project")
	if projectID == "" {
		return fmt.Errorf("destination list %s has no board", listID)
	}
	return checkBoardWrite(app, req.OwnerID, projectID)
}

// createCard makes one card at the end of a list.
//
// `project` is derived from the list rather than taken as a param: the two must
// agree or the card is invisible (the board query joins on project), and a
// derived value cannot disagree. `number` is NOT allocated here — the
// OnRecordCreate hook in card_number.go owns that column for every caller, and
// allocating again would burn a number per rule-created card.
//
// Authorization lives in createCardListAuthorizer, which the engine runs first.
func createCard(app core.App, req automation.ActionRequest) error {
	listID := req.Params["list"]
	if listID == "" {
		return fmt.Errorf("boards:create-card: no destination list")
	}
	title := strings.TrimSpace(req.Params["title"])
	if title == "" {
		return fmt.Errorf("boards:create-card: a card needs a title")
	}
	// -1 leaves room for the ellipsis truncateRunes appends: at exactly the
	// column's max it would return max+1 runes and the save would fail
	// validation, which is the outcome truncating exists to avoid.
	title = truncateRunes(title, cardTitleRuneLimit-1)

	list, err := app.FindRecordById("boards_lists", listID)
	if err != nil {
		return fmt.Errorf("destination list %s: %w", listID, err)
	}
	col, err := app.FindCollectionByNameOrId("boards_cards")
	if err != nil {
		return fmt.Errorf("boards_cards: %w", err)
	}
	position, err := rankAppendToList(app, listID)
	if err != nil {
		return fmt.Errorf("boards:create-card: rank for list %s: %w", listID, err)
	}

	card := core.NewRecord(col)
	card.Set("project", list.GetString("project"))
	card.Set("list", listID)
	card.Set("title", title)
	card.Set("position", position)
	// The rule's owner is the author. Attributing to the person whose edit
	// happened to trip the rule would credit them with a card they did not
	// write, and history reads created_by.
	card.Set("created_by", req.OwnerID)

	// boards:card-created is a trigger, so this create re-enters the engine.
	// Unstamped it would arrive as an ordinary user create at depth 0 and a
	// create-on-create rule would never terminate — see appendRelation.
	return automation.MarkEngineWrite(req, card.Id, func() error {
		return app.Save(card)
	})
}

// setDueDate moves the trigger card's deadline by a number of days.
//
// RELATIVE ONLY, and always to a DAY. The server has no user time zone —
// nothing in core carries one — so it cannot honestly resolve "5pm" for the
// rule's author; due_notices.go works in the same UTC day frame for the same
// reason. An absolute time param would silently mean the SERVER's 5pm, which
// is the wrong hour for anyone not sitting beside it.
//
// The consequence, accepted deliberately: a card whose deadline named a TIME
// loses that time when a rule reschedules it. due_has_time goes false and the
// card becomes due on a calendar day. Destroying a time the user chose is a
// real cost, taken over a time that is quietly wrong in every zone but one.
func setDueDate(app core.App, req automation.ActionRequest) error {
	if req.Record == nil {
		return fmt.Errorf("boards:set-due-date needs a card — attach it to a card trigger, not a schedule")
	}
	raw := strings.TrimSpace(req.Params["days"])
	if raw == "" {
		return fmt.Errorf("boards:set-due-date: no day offset given")
	}
	days, err := strconv.Atoi(raw)
	if err != nil {
		return fmt.Errorf("boards:set-due-date: %q is not a whole number of days", raw)
	}
	if days < -maxDueShiftDays || days > maxDueShiftDays {
		return fmt.Errorf(
			"boards:set-due-date: %d days is beyond the %d-day limit", days, maxDueShiftDays)
	}

	card, err := app.FindRecordById("boards_cards", req.Record.Id)
	if err != nil {
		return fmt.Errorf("load card %s: %w", req.Record.Id, err)
	}
	if err := checkBoardWrite(app, req.OwnerID, card.GetString("project")); err != nil {
		return err
	}

	// Measured from the card's existing deadline when it has one, and from
	// today when it does not — so "+7" both postpones a dated card by a week
	// and gives an undated one a deadline a week out.
	base := time.Now().UTC()
	if due := card.GetDateTime("due"); !due.IsZero() {
		base = due.Time().UTC()
	}
	next := time.Date(base.Year(), base.Month(), base.Day(), 0, 0, 0, 0, time.UTC).
		AddDate(0, 0, days)

	card.Set("due", next.Format(pbDateFormat))
	card.Set("due_has_time", false)
	// registerDueNotices clears the stamps on any due change, so the new
	// deadline notifies again — but that hook is bound on the request path and
	// this save is the engine's, so clear them here too rather than depend on
	// which hooks a given composition happens to bind.
	card.Set("due_soon_notified_at", "")
	card.Set("overdue_notified_at", "")

	// `due` is watched by boards:card-rescheduled (and the stamps by the two
	// deadline triggers), so this write re-enters the engine — stamp it or a
	// reschedule-on-reschedule rule never terminates.
	return automation.MarkEngineWrite(req, card.Id, func() error {
		return app.Save(card)
	})
}

// moveDestinationAuthorizer answers the which-record question for
// boards:move-card's `list` param: the destination must be a list on the SAME
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
		return fmt.Errorf("boards:move-card: no trigger card to move")
	}
	dest, err := app.FindRecordById("boards_lists", destID)
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

// parentAuthorizer answers the which-record question for boards:set-parent's
// `parent` param. moveDestinationAuthorizer's shape, reading boards_cards
// instead of boards_lists, and for the same two reasons — visibility is not
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
		return fmt.Errorf("boards:set-parent: no trigger card to re-parent")
	}
	if parentID == req.Record.Id {
		return fmt.Errorf("a card cannot be its own sub-task")
	}
	parent, err := app.FindRecordById("boards_cards", parentID)
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
// roles mirror boards_cards' own updateRule (`viaWriter`, 1980000000) and
// lib/permissions.ts: owner and editor write; commentor and viewer do not.
func checkBoardWrite(app core.App, userID, projectID string) error {
	if userID == "" {
		return fmt.Errorf("no rule owner to authorize the move as")
	}
	members, err := app.FindRecordsByFilter(
		"boards_project_members",
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

// cardOwnerResolver maps a boards_cards row to the users the card belongs to:
// every member of its board.
//
// boards_cards has created_by, but auto-detection does not look for it — and
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
		"boards_project_members",
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
	list, err := app.FindRecordById("boards_lists", listID)
	if err != nil {
		return "", false
	}
	return listCategory(list), true
}

// cardMovedToDoneList is the TriggerFilter for "boards:card-completed".
//
// card-completed and card-moved fire on the same event — a change to the
// card's `list`. What separates them is the DESTINATION list's category,
// which lives on boards_lists rather than on the card, so a rule condition
// cannot express it: conditions see only the trigger collection's own
// columns. Hence a filter. Only `done` counts: a canceled list is closed, but
// it is not a completion — that is cardMovedToCanceledList's event.
func cardMovedToDoneList(app core.App, record *core.Record) bool {
	category, ok := cardListCategory(app, record)
	return ok && category == "done"
}

// cardMovedToCanceledList is the TriggerFilter for "boards:card-canceled".
func cardMovedToCanceledList(app core.App, record *core.Record) bool {
	category, ok := cardListCategory(app, record)
	return ok && category == "canceled"
}

// cardIsArchived is the TriggerFilter for "boards:card-archived": the watched
// column flipped, and it flipped TO archived. The auto-archive sweep's saves
// pass through here at depth 0 like any other, which is intended — a rule
// that says "when a card is archived, tell the team" should hear about the
// sweep's archives too.
func cardIsArchived(_ core.App, record *core.Record) bool {
	return record != nil && record.GetBool("archived")
}

// stampJustSet reports that a notice stamp went from empty to set on this
// save — the sweep marking a card, rather than registerDueNotices clearing the
// stamps because someone moved the deadline.
//
// The watch list alone cannot express this. `watch` fires on any change to the
// column, and a reschedule CLEARS both stamps, so without this gate moving a
// due date would fire "card overdue" — precisely backwards.
//
// Fails closed on a nil record: an unreadable save is not evidence a deadline
// passed, and a false "overdue" is the worse error.
func stampJustSet(record *core.Record, field string) bool {
	if record == nil {
		return false
	}
	if record.GetDateTime(field).IsZero() {
		return false
	}
	return record.Original().GetDateTime(field).IsZero()
}

// cardBecameOverdue is the TriggerFilter for "boards:card-overdue".
//
// The closed-list re-check is not redundant with the sweep's own: a rule fires
// off whatever save reaches the hook, and a card can be moved to a done list in
// the same window. Finished work is not late, whichever way it finished — the
// invariant cardInClosedList exists to state.
func cardBecameOverdue(app core.App, record *core.Record) bool {
	return stampJustSet(record, "overdue_notified_at") && !cardInClosedList(app, record)
}

// cardBecameDueSoon is the TriggerFilter for "boards:card-due-soon".
//
// The sweep stamps due_soon_notified_at even when it sends no "soon" notice —
// a card first seen already overdue gets the overdue notice only, and the soon
// stamp is written to suppress stale news. Reading the stamp alone would fire
// "due soon" on a card that is in fact late, so this asserts the card is not
// yet overdue as well.
func cardBecameDueSoon(app core.App, record *core.Record) bool {
	if !stampJustSet(record, "due_soon_notified_at") || cardInClosedList(app, record) {
		return false
	}
	return record.GetDateTime("overdue_notified_at").IsZero()
}

// cardInClosedList: the card's work has stopped, one way or the other. What
// the due-date reminders and the auto-archive sweep ask.
func cardInClosedList(app core.App, record *core.Record) bool {
	category, ok := cardListCategory(app, record)
	return ok && (category == "done" || category == "canceled")
}
