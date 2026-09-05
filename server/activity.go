package boards

import (
	"strconv"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/logging"
)

// Card history: one boards_activity row per change a person can see.
//
// Written from the AFTER-success hooks, which is deliberate on two counts.
// First, a row must describe a write that happened, and only the after hook
// knows it did. Second, `Original()` there is still the pre-save snapshot
// (PocketBase refreshes originalData only on a database load, never after
// Save), so the before/after diff is available without a second read.
//
// `position` is never watched: a drag that only reorders a column is not an
// event anyone wants in a card's history, exactly as the automation
// `card-moved` trigger watches `list` alone. Description edits are coalesced
// — the collaborative flush saves every few seconds while someone types, and
// one "edited the description" per sitting is the honest record.
//
// Never fails the user's write (the counters.go invariant): a history row is
// worth having, not worth refusing a card move over.

var activityLog = logging.ForPackage("boards")

// descriptionCoalesceWindow is how long a description edit by the same actor
// keeps folding into the previous row.
const descriptionCoalesceWindow = 10 * time.Minute

// relationHistoryOwned marks a card save whose caller writes the `parent`,
// `epic` and `sprint` rows ITSELF — the cross-board move and the sprint
// lifecycle, which save through a transaction with an actor the request
// hooks never saw. Without the mark the after-success diff below would write
// a second, unattributed copy of each of those rows. Keyed by record pointer,
// the actor.go convention.
var relationHistoryOwned sync.Map // *core.Record → struct{}

// ownRelationHistory sets the mark for one card and returns its release.
func ownRelationHistory(card *core.Record) func() {
	relationHistoryOwned.Store(card, struct{}{})
	return func() { relationHistoryOwned.Delete(card) }
}

func registerCardActivity(app core.App) {
	app.OnRecordAfterCreateSuccess("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		// A bulk import writes no per-card history: 500 "created" rows say
		// nothing one "imported" does not, and they bury the history of the
		// work that follows. See import_quiet.go.
		if isQuietImport(e.Record) {
			return e.Next()
		}
		actor := actorOf(e.Record)
		writeActivity(e.App, e.Record, actor, "created", "", "")
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		actor := actorOf(e.Record)
		logCardChanges(e.App, e.Record, actor)
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("boards_checklist_items").BindFunc(func(e *core.RecordEvent) error {
		actor := actorOf(e.Record)
		original := e.Record.Original()
		if original.GetString("card") != "" && e.Record.GetBool("is_done") && !original.GetBool("is_done") {
			if card := parentCard(e.App, e.Record.GetString("card")); card != nil {
				writeActivity(e.App, card, actor, "checklist_done", "", e.Record.GetString("title"))
			}
		}
		return e.Next()
	})
	app.OnRecordAfterCreateSuccess("boards_attachments").BindFunc(func(e *core.RecordEvent) error {
		actor := actorOf(e.Record)
		if card := parentCard(e.App, e.Record.GetString("card")); card != nil {
			name := e.Record.GetString("name")
			if name == "" {
				name = e.Record.GetString("file")
			}
			writeActivity(e.App, card, actor, "attachment_added", "", name)
		}
		return e.Next()
	})
}

// logCardChanges diffs a saved card against its stored snapshot.
func logCardChanges(app core.App, card *core.Record, actor string) {
	original := card.Original()
	// The blank-Original guard from comment_edited.go: a record re-saved
	// without a reload has nothing to compare against, and `project` is
	// required, so blank means unknown rather than "was empty".
	if original.GetString("project") == "" {
		return
	}

	if from, to := original.GetString("list"), card.GetString("list"); from != to {
		writeActivity(app, card, actor, "moved", from, to)
	}
	added, removed := setDiff(original.GetStringSlice("assignees"), card.GetStringSlice("assignees"))
	for _, id := range added {
		writeActivity(app, card, actor, "assignee_added", "", id)
	}
	for _, id := range removed {
		writeActivity(app, card, actor, "assignee_removed", id, "")
	}
	added, removed = setDiff(original.GetStringSlice("labels"), card.GetStringSlice("labels"))
	for _, id := range added {
		writeActivity(app, card, actor, "label_added", "", id)
	}
	for _, id := range removed {
		writeActivity(app, card, actor, "label_removed", id, "")
	}
	if original.GetString("due") != card.GetString("due") ||
		original.GetBool("due_has_time") != card.GetBool("due_has_time") {
		writeActivity(app, card, actor, "due", dueText(original), dueText(card))
	}
	if from, to := original.GetString("start"), card.GetString("start"); from != to {
		writeActivity(app, card, actor, "start", dayText(from), dayText(to))
	}
	if from, to := original.GetString("title"), card.GetString("title"); from != to {
		writeActivity(app, card, actor, "title", from, to)
	}
	if original.GetString("description") != card.GetString("description") &&
		!recentDescriptionEdit(app, card.Id, actor) {
		writeActivity(app, card, actor, "description", "", "")
	}
	if from, to := original.GetString("reporter"), card.GetString("reporter"); from != to {
		writeActivity(app, card, actor, "reporter", from, to)
	}
	if from, to := original.GetString("priority"), card.GetString("priority"); from != to {
		writeActivity(app, card, actor, "priority", from, to)
	}
	// One kind for both directions, the self-describing convention dueText and
	// estimateText use: a blank `to` is a card that stopped being a sub-task,
	// a blank `from` one that became one. Raw ids, resolved to card keys at
	// render like every other relation here.
	if _, owned := relationHistoryOwned.Load(card); !owned {
		if from, to := original.GetString("parent"), card.GetString("parent"); from != to {
			writeActivity(app, card, actor, "parent", from, to)
		}
		// Both grouping relations, the parent shape: a blank `to` is a card
		// leaving, a blank `from` one joining. The epic branch was missing
		// until sprints landed — an ordinary re-file wrote no history, only a
		// cross-board move did.
		if from, to := original.GetString("epic"), card.GetString("epic"); from != to {
			writeActivity(app, card, actor, "epic", from, to)
		}
		if from, to := original.GetString("sprint"), card.GetString("sprint"); from != to {
			writeActivity(app, card, actor, "sprint", from, to)
		}
	}
	if from, to := original.GetInt("estimate"), card.GetInt("estimate"); from != to {
		writeActivity(app, card, actor, "estimate", estimateText(from), estimateText(to))
	}
	if was, now := original.GetBool("archived"), card.GetBool("archived"); was != now {
		if now {
			writeActivity(app, card, actor, "archived", "", "")
		} else {
			writeActivity(app, card, actor, "restored", "", "")
		}
	}
}

// dueText renders a card's due date for a history row in a SELF-DESCRIBING
// form: the bare day for a day-only deadline, the RFC 3339 instant for a
// timed one. The renderer tells them apart by shape, so a row never needs
// the flag it was written under — and rows from before the flag existed,
// which stored the raw '…T00:00:00.000Z', still read as days.
func dueText(rec *core.Record) string {
	due := rec.GetDateTime("due")
	if due.IsZero() {
		return ""
	}
	if rec.GetBool("due_has_time") {
		return due.Time().UTC().Format(time.RFC3339)
	}
	return dayText(rec.GetString("due"))
}

// dayText keeps the day half of a stored date.
func dayText(value string) string {
	if len(value) >= 10 {
		return value[:10]
	}
	return value
}

// estimateText renders points for a history row: "" for the stored 0 that
// means "no estimate", so the renderer can say "cleared" without knowing the
// convention, and a plain integer otherwise.
func estimateText(points int) string {
	if points <= 0 {
		return ""
	}
	return strconv.Itoa(points)
}

// writeActivity inserts one row. Failure is logged, never returned: the
// card write it describes has already succeeded.
func writeActivity(app core.App, card *core.Record, actor, kind, from, to string) {
	col, err := app.FindCollectionByNameOrId("boards_activity")
	if err != nil {
		activityLog.Warn("activity collection missing", "error", err)
		return
	}
	row := core.NewRecord(col)
	row.Set("project", card.GetString("project"))
	row.Set("card", card.Id)
	row.Set("actor", actor)
	row.Set("kind", kind)
	row.Set("from", truncateRunes(from, 1000))
	row.Set("to", truncateRunes(to, 1000))
	if err := app.Save(row); err != nil {
		activityLog.Warn("activity write failed", "card", card.Id, "kind", kind, "error", err)
	}
}

// recentDescriptionEdit reports whether the card's latest history row is a
// description edit by the same actor inside the coalesce window.
func recentDescriptionEdit(app core.App, cardID, actor string) bool {
	rows, err := app.FindRecordsByFilter(
		"boards_activity",
		"card = {:card}",
		"-created",
		1,
		0,
		dbx.Params{"card": cardID},
	)
	if err != nil || len(rows) == 0 {
		return false
	}
	latest := rows[0]
	if latest.GetString("kind") != "description" || latest.GetString("actor") != actor {
		return false
	}
	return time.Since(latest.GetDateTime("created").Time()) < descriptionCoalesceWindow
}

func parentCard(app core.App, cardID string) *core.Record {
	if cardID == "" {
		return nil
	}
	card, err := app.FindRecordById("boards_cards", cardID)
	if err != nil {
		return nil
	}
	return card
}

// setDiff returns the ids in `next` not in `prev`, and the ids in `prev` not
// in `next` — order preserved from the slice they came from.
func setDiff(prev, next []string) (added, removed []string) {
	prevSet := make(map[string]bool, len(prev))
	for _, id := range prev {
		prevSet[id] = true
	}
	nextSet := make(map[string]bool, len(next))
	for _, id := range next {
		nextSet[id] = true
		if !prevSet[id] {
			added = append(added, id)
		}
	}
	for _, id := range prev {
		if !nextSet[id] {
			removed = append(removed, id)
		}
	}
	return added, removed
}
