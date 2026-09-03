package cards

import (
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/notify"
)

// Card notifications beyond @mentions: assignment, replies, and changes to a
// card someone watches.
//
// Four notification TYPES, and each is also a mute switch in core's
// notification preferences (use-notification-preferences.ts):
//
//	cards_assigned  you were assigned
//	cards_reply     someone replied to your comment
//	cards_watched   a card you watch changed — Meta.event says how:
//	                comment | moved | completed | archived
//	cards_due       a card you watch or own is due soon / overdue (due_notices.go)
//
// PRECEDENCE, per event: one notification per person. A reply's author is
// told it is a reply, not that a watched card gained a comment; someone
// @mentioned in the comment already got cards_mention from core's pipeline
// and is skipped here; everyone else watching gets cards_watched. The actor
// is never told about their own action.
//
// The hooks hand off to a goroutine, as core's comment_mentions.go does — a
// push dispatch can stall, and it must not delay the write's response. The
// handlers themselves are synchronous and take the record, so the tests call
// them directly.

const (
	notifyTypeAssigned = "cards_assigned"
	notifyTypeReply    = "cards_reply"
	notifyTypeWatched  = "cards_watched"
)

func registerCardNotifications(app core.App) {
	app.OnRecordAfterUpdateSuccess("cards_cards").BindFunc(func(e *core.RecordEvent) error {
		actor := actorOf(e.Record)
		go notifyCardUpdate(app, e.Record, actor)
		return e.Next()
	})
	app.OnRecordAfterCreateSuccess("cards_comments").BindFunc(func(e *core.RecordEvent) error {
		go notifyNewComment(app, e.Record)
		return e.Next()
	})
}

// notifyCardUpdate fans out the notifications one saved card implies.
func notifyCardUpdate(app core.App, card *core.Record, actor string) {
	original := card.Original()
	if original.GetString("project") == "" {
		return
	}
	who := actorName(app, actor)
	title := truncateRunes(card.GetString("title"), 200)

	added, _ := setDiff(original.GetStringSlice("assignees"), card.GetStringSlice("assignees"))
	for _, userID := range added {
		if userID == actor {
			continue
		}
		deliver(app, userID, notifyTypeAssigned, who+" assigned you a card", title, card, "assigned")
	}

	if original.GetString("list") != card.GetString("list") {
		event, headline := "moved", who+" moved a card you watch"
		if cardMovedToDoneList(app, card) {
			event, headline = "completed", who+" completed a card you watch"
		}
		for _, userID := range watcherIDs(app, card.Id) {
			if userID == actor {
				continue
			}
			deliver(app, userID, notifyTypeWatched, headline, title, card, event)
		}
	}

	if card.GetBool("archived") && !original.GetBool("archived") {
		for _, userID := range watcherIDs(app, card.Id) {
			if userID == actor {
				continue
			}
			deliver(app, userID, notifyTypeWatched, who+" archived a card you watch", title, card, "archived")
		}
	}
}

// notifyNewComment tells the replied-to author, then the other watchers.
func notifyNewComment(app core.App, comment *core.Record) {
	card, err := app.FindRecordById("cards_cards", comment.GetString("card"))
	if err != nil {
		return
	}
	author := comment.GetString("author")
	who := actorName(app, author)
	title := truncateRunes(card.GetString("title"), 200)

	told := map[string]bool{author: true}
	// Mentioned users already received cards_mention from core's pipeline.
	for _, id := range parseMentions(comment.GetString("body")) {
		told[id] = true
	}

	if parentID := comment.GetString("parent"); parentID != "" {
		if parent, err := app.FindRecordById("cards_comments", parentID); err == nil {
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

func deliver(app core.App, userID, kind, headline, body string, card *core.Record, event string) {
	notify.NotifyUser(app, notify.NotifyParams{
		UserID:  userID,
		Type:    kind,
		Package: "cards",
		Title:   headline,
		Body:    body,
		URL:     descriptionMentionURL(app, card.Id),
		Meta: map[string]any{
			"targetCollection": "cards_cards",
			"targetRecord":     card.Id,
			"project":          card.GetString("project"),
			"event":            event,
		},
	})
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
