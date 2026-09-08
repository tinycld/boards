package boards

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/notify"
)

// Card notifications beyond @mentions: assignment, replies, and changes to a
// card someone watches.
//
// Five notification TYPES, and each is also a mute switch in core's
// notification preferences (use-notification-preferences.ts):
//
//	boards_assigned  you were assigned
//	boards_reply     someone replied to your comment
//	boards_reaction  someone reacted to your comment
//	boards_watched   a card you watch changed — Meta.event says how:
//	                comment | moved | completed | canceled | archived | updated
//	                `updated` is the catch-all for a field edit (title,
//	                priority, estimate, dates, labels, epic, sprint, parent,
//	                reporter); its Meta.fields lists which ones. ONE such
//	                notification per save, however many fields it touched.
//	boards_due       a card you watch or own is due soon / overdue (due_notices.go)
//	boards_sprint    a sprint on your board started or completed — Meta.event
//	                says which; sent to every member (a sprint is board news,
//	                not card news, so watchers are not the audience)
//
// PRECEDENCE, per event: one notification per person. A reply's author is
// told it is a reply, not that a watched card gained a comment; someone
// @mentioned in the comment already got boards_mention from core's pipeline
// and is skipped here; everyone else watching gets boards_watched. The actor
// is never told about their own action.
//
// The hooks hand off to a goroutine, as core's comment_mentions.go does — a
// push dispatch can stall, and it must not delay the write's response. The
// handlers themselves are synchronous and take the record, so the tests call
// them directly.

const (
	notifyTypeAssigned = "boards_assigned"
	notifyTypeReply    = "boards_reply"
	notifyTypeReaction = "boards_reaction"
	notifyTypeWatched  = "boards_watched"
	notifyTypeSprint   = "boards_sprint"
)

func registerCardNotifications(app core.App) {
	app.OnRecordAfterUpdateSuccess("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		actor := actorOf(e.Record)
		go notifyCardUpdate(app, e.Record, actor)
		return e.Next()
	})
	app.OnRecordAfterCreateSuccess("boards_comments").BindFunc(func(e *core.RecordEvent) error {
		// An import carries a board's whole comment history across; notifying
		// on each one would be a mailbox full of years-old conversation. See
		// import_quiet.go.
		if isQuietImport(e.Record) {
			return e.Next()
		}
		go notifyNewComment(app, e.Record)
		return e.Next()
	})
	app.OnRecordAfterCreateSuccess("boards_comment_reactions").BindFunc(func(e *core.RecordEvent) error {
		go notifyReaction(app, e.Record)
		return e.Next()
	})
}

// notifyReaction tells a comment's author that someone reacted to it. Only
// the author: a reaction is a nod to one person, not news about the card, so
// the watchers are left alone. Reacting to your own comment tells nobody.
func notifyReaction(app core.App, reaction *core.Record) {
	comment, err := app.FindRecordById("boards_comments", reaction.GetString("comment"))
	if err != nil {
		return
	}
	author := comment.GetString("author")
	reactor := reaction.GetString("user")
	if author == "" || author == reactor {
		return
	}
	card, err := app.FindRecordById("boards_cards", comment.GetString("card"))
	if err != nil {
		return
	}
	who := actorName(app, reactor)
	title := truncateRunes(card.GetString("title"), 200)
	deliver(app, author, notifyTypeReaction, who+" reacted "+reaction.GetString("emoji")+" to your comment", title, card, "reaction")
}

// notifyCardUpdate fans out the notifications one saved card implies.
func notifyCardUpdate(app core.App, card *core.Record, actor string) {
	original := card.Original()
	if original.GetString("project") == "" {
		return
	}
	who := actorName(app, actor)
	title := truncateRunes(card.GetString("title"), 200)

	// One notification per person per save, the precedence rule the comment
	// above states: someone told they were assigned is not also told the card
	// they were just handed had its priority changed.
	told := map[string]bool{}

	added, _ := setDiff(original.GetStringSlice("assignees"), card.GetStringSlice("assignees"))
	for _, userID := range added {
		if userID == actor {
			continue
		}
		told[userID] = true
		deliver(app, userID, notifyTypeAssigned, who+" assigned you a card", title, card, "assigned")
	}

	// A save that moved or archived the card has already told the watchers
	// about it; the field summary below stays quiet rather than making one
	// save two notifications to one person.
	announced := false

	if original.GetString("list") != card.GetString("list") {
		announced = true
		event, headline := "moved", who+" moved a card you watch"
		switch category, _ := cardListCategory(app, card); category {
		case "done":
			event, headline = "completed", who+" completed a card you watch"
		case "canceled":
			event, headline = "canceled", who+" canceled a card you watch"
		}
		for _, userID := range watcherIDs(app, card.Id) {
			if userID == actor {
				continue
			}
			deliver(app, userID, notifyTypeWatched, headline, title, card, event)
		}
	}

	if card.GetBool("archived") && !original.GetBool("archived") {
		announced = true
		for _, userID := range watcherIDs(app, card.Id) {
			if userID == actor {
				continue
			}
			deliver(app, userID, notifyTypeWatched, who+" archived a card you watch", title, card, "archived")
		}
	}

	// Everything else one save changed, as a SINGLE notification naming the
	// fields. One per save rather than one per field: a detail-panel edit
	// commonly sets priority, estimate and a due date in one write, and three
	// pushes for that is how a notification type gets muted.
	if announced {
		return
	}
	fields, labels := changedFields(card)
	if len(fields) == 0 {
		return
	}
	body := truncateRunes(title+" — "+joinLabels(labels), 200)
	for _, userID := range watcherIDs(app, card.Id) {
		if userID == actor || told[userID] {
			continue
		}
		deliverFields(app, userID, who+" updated a card you watch", body, card, fields)
	}
}

// notifyNewComment tells the replied-to author, then the other watchers.
func notifyNewComment(app core.App, comment *core.Record) {
	card, err := app.FindRecordById("boards_cards", comment.GetString("card"))
	if err != nil {
		return
	}
	author := comment.GetString("author")
	who := actorName(app, author)
	title := truncateRunes(card.GetString("title"), 200)

	told := map[string]bool{author: true}
	// Mentioned users already received boards_mention from core's pipeline.
	for _, id := range parseMentions(comment.GetString("body")) {
		told[id] = true
	}

	if parentID := comment.GetString("parent"); parentID != "" {
		if parent, err := app.FindRecordById("boards_comments", parentID); err == nil {
			if target := parent.GetString("author"); target != "" && !told[target] {
				told[target] = true
				deliver(app, target, notifyTypeReply, who+" replied to your comment", title, card, "reply")
			}
		}
	}

	for _, userID := range watcherIDs(app, card.Id) {
		if told[userID] {
			continue
		}
		told[userID] = true
		deliver(app, userID, notifyTypeWatched, who+" commented on a card you watch", title, card, "comment")
	}
}

// registerSprintNotifications tells a board's members when a sprint starts
// or completes. Bound on the after-update hook: the transition is a state
// change on the sprint row, whoever made it — a person through the endpoint
// or the sweep on the sprint's dates.
func registerSprintNotifications(app core.App) {
	app.OnRecordAfterUpdateSuccess("boards_sprints").BindFunc(func(e *core.RecordEvent) error {
		actor := actorOf(e.Record)
		go notifySprintTransition(app, e.Record, actor)
		return e.Next()
	})
}

// notifySprintTransition fans out one sprint's start or completion. The actor
// is never told about their own action; the sweep has no actor and tells
// everyone.
func notifySprintTransition(app core.App, sprint *core.Record, actor string) {
	original := sprint.Original()
	if original.GetString("project") == "" {
		return
	}
	from, to := original.GetString("state"), sprint.GetString("state")
	if from == to {
		return
	}
	var event, headline string
	switch {
	case from == sprintPlanned && to == sprintActive:
		event, headline = "started", sprintLabelOf(sprint)+" started"
	case from == sprintActive && to == sprintCompleted:
		event, headline = "completed", sprintLabelOf(sprint)+" completed"
	default:
		return
	}
	if actor != "" {
		headline = actorName(app, actor) + " " + lowerFirst(headline)
	}
	body := truncateRunes(sprint.GetString("goal"), 200)
	if body == "" {
		body = fmt.Sprintf("%d cards", sprint.GetInt("card_total"))
	}
	for _, userID := range cardOwnerResolver(app, sprint) {
		if userID == actor {
			continue
		}
		notify.NotifyUser(app, notify.NotifyParams{
			UserID:  userID,
			Type:    notifyTypeSprint,
			Package: "boards",
			Title:   headline,
			Body:    body,
			URL:     sprintBoardURL(app, sprint),
			Meta: map[string]any{
				"targetCollection": "boards_sprints",
				"targetRecord":     sprint.Id,
				"project":          sprint.GetString("project"),
				"event":            event,
			},
		})
	}
}

// sprintLabelOf mirrors lib/sprint.ts's sprintLabel.
func sprintLabelOf(sprint *core.Record) string {
	if name := sprint.GetString("name"); name != "" {
		return name
	}
	return fmt.Sprintf("Sprint %d", sprint.GetInt("number"))
}

func lowerFirst(s string) string {
	runes := []rune(s)
	if len(runes) == 0 {
		return s
	}
	// Only a generic "Sprint N …" headline lowercases; a named sprint keeps
	// its name's own casing.
	if runes[0] == 'S' && len(runes) > 6 && string(runes[:7]) == "Sprint " {
		runes[0] = 's'
	}
	return string(runes)
}

func deliver(app core.App, userID, kind, headline, body string, card *core.Record, event string) {
	notify.NotifyUser(app, notify.NotifyParams{
		UserID:  userID,
		Type:    kind,
		Package: "boards",
		Title:   headline,
		Body:    body,
		URL:     cardURL(app, card.Id),
		Meta:    cardMeta(card, event, nil),
	})
}

// deliverFields is deliver for the field-change summary, whose Meta also
// carries WHICH fields changed so a reader (or a future UI) can render the
// change without re-diffing the card.
func deliverFields(app core.App, userID, headline, body string, card *core.Record, fields []string) {
	notify.NotifyUser(app, notify.NotifyParams{
		UserID:  userID,
		Type:    notifyTypeWatched,
		Package: "boards",
		Title:   headline,
		Body:    body,
		URL:     cardURL(app, card.Id),
		Meta:    cardMeta(card, "updated", fields),
	})
}

// cardMeta is the payload every card notification carries. `fields` is set
// only by the update summary, and omitted entirely when empty so an existing
// consumer sees the shape it already expects.
func cardMeta(card *core.Record, event string, fields []string) map[string]any {
	meta := map[string]any{
		"targetCollection": "boards_cards",
		"targetRecord":     card.Id,
		"project":          card.GetString("project"),
		"event":            event,
	}
	if len(fields) > 0 {
		meta["fields"] = fields
	}
	return meta
}

// actorName renders who did something. A write with no actor — a rule, a
// seed — is "A rule": naming the wrong person is worse than naming none.
func actorName(app core.App, userID string) string {
	if userID == "" {
		return "A rule"
	}
	user, err := app.FindRecordById("users", userID)
	if err != nil {
		return "Someone"
	}
	if name := user.GetString("name"); name != "" {
		return name
	}
	if email := user.GetString("email"); email != "" {
		return email
	}
	return "Someone"
}

// --- field-change summaries ---------------------------------------------

// Fields whose change is worth telling a watcher about, in the order they are
// named in the summary body. Fixed rather than map order so the body is
// deterministic and the tests can assert it.
//
// Four card fields are deliberately absent, each because it ALREADY has its
// own notification and naming it here would tell one person twice about one
// save:
//
//	list       -> moved / completed / canceled, above
//	archived   -> archived, above
//	assignees  -> boards_assigned, above
//	description-> mentions in it send boards_mention (description_mentions.go),
//	              and the collaborative flush saves every few seconds while
//	              someone types — a per-flush page is not something anyone wants.
//
// `position` is absent for the reason it is absent from history: a drag that
// reorders a column is not an event.
var notifiableCardFields = []struct {
	field string
	label string
	// changed reports whether this field differs between the stored snapshot
	// and the saved record. Mirrors the comparison logCardChanges makes for
	// the same field, so history and notifications never disagree about
	// whether something changed.
	changed func(original, card *core.Record) bool
}{
	{"title", "the title", func(o, c *core.Record) bool {
		return o.GetString("title") != c.GetString("title")
	}},
	{"priority", "the priority", func(o, c *core.Record) bool {
		return o.GetString("priority") != c.GetString("priority")
	}},
	{"estimate", "the estimate", func(o, c *core.Record) bool {
		return o.GetInt("estimate") != c.GetInt("estimate")
	}},
	// The due comparison carries due_has_time, as logCardChanges does: giving
	// a day-only deadline a time is a new deadline even when the day is equal.
	{"due", "the due date", func(o, c *core.Record) bool {
		return o.GetString("due") != c.GetString("due") ||
			o.GetBool("due_has_time") != c.GetBool("due_has_time")
	}},
	{"start", "the start date", func(o, c *core.Record) bool {
		return o.GetString("start") != c.GetString("start")
	}},
	{"labels", "labels", func(o, c *core.Record) bool {
		added, removed := setDiff(o.GetStringSlice("labels"), c.GetStringSlice("labels"))
		return len(added) > 0 || len(removed) > 0
	}},
	{"epic", "the epic", func(o, c *core.Record) bool {
		return o.GetString("epic") != c.GetString("epic")
	}},
	{"sprint", "the sprint", func(o, c *core.Record) bool {
		return o.GetString("sprint") != c.GetString("sprint")
	}},
	{"parent", "the parent card", func(o, c *core.Record) bool {
		return o.GetString("parent") != c.GetString("parent")
	}},
	{"reporter", "the reporter", func(o, c *core.Record) bool {
		return o.GetString("reporter") != c.GetString("reporter")
	}},
}

// changedFields names the notifiable fields one save altered, as the field
// keys (for Meta) and their display labels (for the body).
func changedFields(card *core.Record) (fields, labels []string) {
	original := card.Original()
	for _, f := range notifiableCardFields {
		if f.changed(original, card) {
			fields = append(fields, f.field)
			labels = append(labels, f.label)
		}
	}
	return fields, labels
}

// joinLabels renders the changed-field labels as a phrase: "the title",
// "the title and the priority", "the title, the priority and the due date".
func joinLabels(labels []string) string {
	switch len(labels) {
	case 0:
		return ""
	case 1:
		return labels[0]
	}
	return strings.Join(labels[:len(labels)-1], ", ") + " and " + labels[len(labels)-1]
}
