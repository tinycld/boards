package cards

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// Card notifications and auto-watching, through the real notify path. The
// handlers are called directly (the hooks hand off to goroutines), on an env
// that also carries core's notifications collection.

func addNotificationsCollection(t *testing.T, app *tests.TestApp) {
	t.Helper()
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	notifications := core.NewBaseCollection("notifications")
	notifications.Fields.Add(&core.RelationField{
		Name: "user", Required: true, CollectionId: users.Id, MaxSelect: 1,
	})
	for _, f := range []string{"type", "package", "title", "body", "url"} {
		notifications.Fields.Add(&core.TextField{Name: f})
	}
	notifications.Fields.Add(&core.JSONField{Name: "metadata"})
	notifications.Fields.Add(&core.BoolField{Name: "read"})
	notifications.Fields.Add(&core.BoolField{Name: "dismissed"})
	if err := app.Save(notifications); err != nil {
		t.Fatalf("save notifications: %v", err)
	}
}

func setupNotifyEnv(t *testing.T) *cardsEnv {
	t.Helper()
	env := setupCardsEnv(t)
	addNotificationsCollection(t, env.app)
	registerActorCapture(env.app)
	registerAutoWatch(env.app)
	return env
}

func notificationTypes(t *testing.T, app core.App, userID string) []string {
	t.Helper()
	out := []string{}
	for _, n := range notificationsFor(t, app, userID) {
		out = append(out, n.GetString("type"))
	}
	return out
}

func requireTypes(t *testing.T, got []string, want ...string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("notifications = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("notifications = %v, want %v", got, want)
		}
	}
}

func isWatching(t *testing.T, app core.App, cardID, userID string) bool {
	t.Helper()
	for _, id := range watcherIDs(app, cardID) {
		if id == userID {
			return true
		}
	}
	return false
}

// --- auto-watch ---------------------------------------------------------

func TestAutoWatch_CreatorAndReporterFollowANewCard(t *testing.T) {
	env := setupNotifyEnv(t)
	card := cardsCard(t, env.app, env.project, env.list, "new", "a1", env.owner)
	if !isWatching(t, env.app, card.Id, env.owner.Id) {
		t.Fatalf("the creator is not watching their card")
	}
}

func TestAutoWatch_AssigneeAndCommenterFollow(t *testing.T) {
	env := setupNotifyEnv(t)
	updateCardAs(t, env.app, env.owner, env.card.Id, func(r *core.Record) {
		r.Set("assignees", []string{env.editor.Id})
	})
	if !isWatching(t, env.app, env.card.Id, env.editor.Id) {
		t.Fatalf("a newly assigned member is not watching")
	}
	cardsComment(t, env.app, env.project, env.card, env.commentor, "hello")
	if !isWatching(t, env.app, env.card.Id, env.commentor.Id) {
		t.Fatalf("a commenter is not watching")
	}
	// Idempotent: a second assignment write does not duplicate the row.
	updateCardAs(t, env.app, env.owner, env.card.Id, func(r *core.Record) {
		r.Set("assignees", []string{env.editor.Id, env.viewer.Id})
	})
	count := 0
	for _, id := range watcherIDs(env.app, env.card.Id) {
		if id == env.editor.Id {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("editor has %d watcher rows, want 1", count)
	}
}

func TestAutoWatch_NonMembersAreNeverAdded(t *testing.T) {
	env := setupNotifyEnv(t)
	updateCardAs(t, env.app, env.owner, env.card.Id, func(r *core.Record) {
		r.Set("assignees", []string{env.outsider.Id})
	})
	if isWatching(t, env.app, env.card.Id, env.outsider.Id) {
		t.Fatalf("an outsider was added as a watcher")
	}
}

// --- notifications ------------------------------------------------------
//
// A handler diffs the record against Original(), which PocketBase refreshes
// only on a database load. So "before" is whatever the DB holds and "after"
// is what the test sets on the loaded record without saving — exactly the
// shape the after-save hook sees.

func loaded(t *testing.T, app core.App, cardID string) *core.Record {
	t.Helper()
	rec, err := app.FindRecordById("cards_cards", cardID)
	if err != nil {
		t.Fatal(err)
	}
	return rec
}

func eventOf(t *testing.T, n *core.Record) string {
	t.Helper()
	var meta map[string]any
	if err := n.UnmarshalJSONField("metadata", &meta); err != nil {
		t.Fatalf("metadata: %v", err)
	}
	event, _ := meta["event"].(string)
	return event
}

func TestNotify_AssignmentTellsTheAssigneeNotTheActor(t *testing.T) {
	env := setupNotifyEnv(t)
	card := loaded(t, env.app, env.card.Id)
	card.Set("assignees", []string{env.editor.Id, env.owner.Id})
	notifyCardUpdate(env.app, card, env.owner.Id)

	requireTypes(t, notificationTypes(t, env.app, env.editor.Id), notifyTypeAssigned)
	requireTypes(t, notificationTypes(t, env.app, env.owner.Id))
}

func TestNotify_MoveAndCompleteReachWatchersWithTheEvent(t *testing.T) {
	env := setupNotifyEnv(t)
	ensureWatcher(env.app, env.project.Id, env.card.Id, env.viewer.Id)
	ensureWatcher(env.app, env.project.Id, env.card.Id, env.owner.Id)

	moved := loaded(t, env.app, env.card.Id)
	moved.Set("list", env.list2.Id)
	notifyCardUpdate(env.app, moved, env.owner.Id)

	viewerNotes := notificationsFor(t, env.app, env.viewer.Id)
	if len(viewerNotes) != 1 || viewerNotes[0].GetString("type") != notifyTypeWatched {
		t.Fatalf("viewer got %v, want one cards_watched", notificationTypes(t, env.app, env.viewer.Id))
	}
	if event := eventOf(t, viewerNotes[0]); event != "moved" {
		t.Fatalf("event = %q, want moved", event)
	}
	// The actor hears nothing about their own move.
	requireTypes(t, notificationTypes(t, env.app, env.owner.Id))

	// Into the done list: the same event, named "completed".
	done := cardsList(t, env.app, env.project, "Done", "a2")
	done.Set("category", "done")
	if err := env.app.Save(done); err != nil {
		t.Fatal(err)
	}
	completed := loaded(t, env.app, env.card.Id)
	completed.Set("list", done.Id)
	notifyCardUpdate(env.app, completed, env.owner.Id)
	// And into a canceled list: named "canceled", never "completed".
	canceled := cardsList(t, env.app, env.project, "Won't do", "a3")
	canceled.Set("category", "canceled")
	if err := env.app.Save(canceled); err != nil {
		t.Fatal(err)
	}
	dropped := loaded(t, env.app, env.card.Id)
	dropped.Set("list", canceled.Id)
	notifyCardUpdate(env.app, dropped, env.owner.Id)
	events := map[string]bool{}
	for _, n := range notificationsFor(t, env.app, env.viewer.Id) {
		events[eventOf(t, n)] = true
	}
	if !events["completed"] || !events["moved"] || !events["canceled"] {
		t.Fatalf("viewer events = %v, want moved, completed and canceled", events)
	}
}

func TestNotify_ServerWriteReachesEveryWatcher(t *testing.T) {
	env := setupNotifyEnv(t)
	ensureWatcher(env.app, env.project.Id, env.card.Id, env.viewer.Id)
	ensureWatcher(env.app, env.project.Id, env.card.Id, env.owner.Id)
	archived := loaded(t, env.app, env.card.Id)
	archived.Set("archived", true)
	notifyCardUpdate(env.app, archived, "")
	requireTypes(t, notificationTypes(t, env.app, env.viewer.Id), notifyTypeWatched)
	requireTypes(t, notificationTypes(t, env.app, env.owner.Id), notifyTypeWatched)
	if title := notificationsFor(t, env.app, env.viewer.Id)[0].GetString("title"); title != "A rule archived a card you watch" {
		t.Fatalf("title = %q, want the rule attribution", title)
	}
}

func TestNotify_CommentTellsWatchersMinusAuthorAndMentioned(t *testing.T) {
	env := setupNotifyEnv(t)
	ensureWatcher(env.app, env.project.Id, env.card.Id, env.viewer.Id)
	ensureWatcher(env.app, env.project.Id, env.card.Id, env.editor.Id)
	ensureWatcher(env.app, env.project.Id, env.card.Id, env.commentor.Id)

	comment := cardsComment(t, env.app, env.project, env.card, env.commentor,
		"ping [[@"+env.editor.Id+"]]")
	notifyNewComment(env.app, comment)

	requireTypes(t, notificationTypes(t, env.app, env.viewer.Id), notifyTypeWatched)
	// Mentioned: core's pipeline told them; this path stays silent.
	requireTypes(t, notificationTypes(t, env.app, env.editor.Id))
	// The author never hears about their own comment.
	requireTypes(t, notificationTypes(t, env.app, env.commentor.Id))
}

func TestNotify_ReplyTellsTheParentAuthorOnce(t *testing.T) {
	env := setupNotifyEnv(t)
	parent := cardsComment(t, env.app, env.project, env.card, env.editor, "first")
	// The editor now watches (commenter auto-watch); a reply must not ALSO
	// send them the watcher notice.
	reply := cardsComment(t, env.app, env.project, env.card, env.owner, "second")
	reply.Set("parent", parent.Id)
	if err := env.app.Save(reply); err != nil {
		t.Fatal(err)
	}
	notifyNewComment(env.app, reply)
	requireTypes(t, notificationTypes(t, env.app, env.editor.Id), notifyTypeReply)
}
