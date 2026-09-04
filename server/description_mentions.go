package boards

import (
	"log/slog"
	"regexp"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/notify"
)

// @mentions inside a card DESCRIPTION.
//
// Comments take the client-inserted `comment_mentions` row (core's shared
// pipeline). A description cannot: it is a Yjs fragment with NO COMMIT. The
// editor is always mounted, every keystroke is shared immediately, and the
// server writes the text back on a debounced flush — so there is no create
// event for a client to hang a mention insert on, and no moment the client
// could call "the user finished writing this mention".
//
// So description mentions are derived SERVER-SIDE, here, at the flush.
//
// THE DEDUP RULE. The flush fires repeatedly while someone types, so the
// question that decides whether this feature is usable or maddening is "which
// mentions are new?". The answer falls out of state that already exists:
// saveDescription re-reads the card record before overwriting it, so the
// STORED description is the previous text. Therefore:
//
//	notify = mentions(new) − mentions(previous)
//
// Only mentions ADDED by this flush notify. Re-saving, reformatting, editing
// elsewhere in the description, or a server restart (which re-derives from the
// stored text, tokens included) all notify nobody.
//
// Note this uses the stored RECORD, not boardDocState's baseline. The baseline
// holds a sha256, not the text, so the old mentions are unrecoverable from it —
// and the record is the more durable source anyway: it survives a restart,
// where the in-memory baseline does not.
//
// WHO GETS ATTRIBUTED, and why it is "Someone". A comment has one author. A
// description does not: the flush is per-BOARD and debounced across every
// connected client, and realtime.FlushFn is `func(ctx context.Context, roomID
// string, handle DocHandle) error` — it carries no auth, by construction. The typist is
// therefore unknowable at this layer. Rather than guess (attributing the edit
// to the room's opener, or the card's reporter, would be wrong the moment two
// people share a board — which is the only case that matters), the
// notification is authored by "Someone". Naming the wrong person is worse than
// naming nobody.
//
// A self-mention therefore CANNOT be filtered here: with no author, there is
// no "self" to compare against. The client suppresses itself from the mention
// picker, which is where that check belongs.
const descriptionMentionType = "boards_mention"

// mentionToken matches the wire format core's client writes: `[[@<userId>]]`.
// Kept in step with boards/tinycld/boards/lib/mention-text.ts by hand.
//
// The brackets may arrive BACKSLASH-ESCAPED. A description is authored in the
// rich editor and serialized to markdown, where `[` is syntax, so the stored
// text is `\[\[@id\]\]` rather than `[[@id]]`. Matching only the bare form
// meant a mention typed with the picker never notified anyone — the same bug
// the TS twin had, caught by card-mentions.spec.ts.
var mentionToken = regexp.MustCompile(`\\?\[\\?\[@([A-Za-z0-9_-]+)\\?\]\\?\]`)

// parseMentions returns the distinct user ids mentioned in body, in order of
// first appearance. Mirrors parseMentions() in core/lib/comments/mentions.ts:
// one entry per user however many times they are named.
func parseMentions(body string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, m := range mentionToken.FindAllStringSubmatch(body, -1) {
		id := m[1]
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

// newMentions returns the ids present in next but not in prev.
func newMentions(prev, next string) []string {
	if next == "" {
		return nil
	}
	old := map[string]bool{}
	for _, id := range parseMentions(prev) {
		old[id] = true
	}
	out := []string{}
	for _, id := range parseMentions(next) {
		if !old[id] {
			out = append(out, id)
		}
	}
	return out
}

// notifyDescriptionMentions fires a notification for every user newly
// mentioned in a card's description.
//
// Called from saveDescription with the text as it was STORED (prev) and the
// text about to replace it (next). Never returns an error: a mention that
// cannot be delivered must not fail the flush, because a failed flush re-marks
// the room dirty and retries forever — one undeliverable notification would
// stall a whole board's persistence.
func notifyDescriptionMentions(app core.App, projectID, cardID, prev, next string) {
	added := newMentions(prev, next)
	if len(added) == 0 {
		return
	}

	for _, userID := range added {
		// Only board members may be notified. A `[[@id]]` token is just text
		// in a collaborative document — anyone with write access to the board
		// could type one naming any user id in the deployment, so without this
		// check the description would be a channel for notifying strangers.
		member, err := app.CountRecords("boards_project_members",
			dbx.HashExp{"project": projectID, "user": userID},
		)
		if err != nil {
			slog.Warn("cards: could not check membership for a description mention",
				"projectID", projectID, "cardID", cardID, "userID", userID, "error", err)
			continue
		}
		if member == 0 {
			continue
		}

		notify.NotifyUser(app, notify.NotifyParams{
			UserID: userID,
			Type:   descriptionMentionType,
			// Matches the manifest slug, so the bell groups it with the rest
			// of boards' notifications.
			Package: "boards",
			// No author to name — see the header.
			Title: "You were mentioned on a card",
			Body:  truncateRunes(cardTitle(app, cardID), 200),
			URL:   descriptionMentionURL(app, cardID),
			Meta: map[string]any{
				"targetCollection": "boards_cards",
				"targetRecord":     cardID,
				"project":          projectID,
				"source":           "description",
			},
		})
	}
}

// cardTitle returns the card's title for the notification body, or a neutral
// fallback. The body answers "which card?", since the title cannot.
func cardTitle(app core.App, cardID string) string {
	rec, err := app.FindRecordById("boards_cards", cardID)
	if err != nil {
		return "A card mentions you"
	}
	if t := rec.GetString("title"); t != "" {
		return t
	}
	return "Untitled card"
}

// descriptionMentionURL deep-links to the card, matching the shape
// core/server/notify/comment_mentions.go builds for a cards comment mention:
// the board route with the card peeked open (usePeekUrl reads `?focused=`,
// which accepts a record id as well as an OTTER-123 key).
func descriptionMentionURL(app core.App, cardID string) string {
	appURL := app.Settings().Meta.AppURL
	for len(appURL) > 0 && appURL[len(appURL)-1] == '/' {
		appURL = appURL[:len(appURL)-1]
	}
	return appURL + "/boards?focused=" + cardID
}

// truncateRunes caps a notification body without splitting a rune.
func truncateRunes(s string, limit int) string {
	runes := []rune(s)
	if len(runes) <= limit {
		return s
	}
	return string(runes[:limit]) + "…"
}
