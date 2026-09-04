package boards

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/rlstest"
)

// --- pure parsing / diffing ---
//
// These are the rules that decide whether the feature is usable: they run on
// EVERY flush, which fires repeatedly while someone types.

func TestParseMentions_DedupesAndPreservesOrder(t *testing.T) {
	got := parseMentions("hi [[@bbb]] and [[@aaa]], again [[@bbb]]")
	want := []string{"bbb", "aaa"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestParseMentions_IgnoresMalformedTokens(t *testing.T) {
	for _, body := range []string{
		"plain text",
		"[@notdouble]",
		"[[@]]",
		"[[user]]",
		"[[@bad id]]",
	} {
		if got := parseMentions(body); len(got) != 0 {
			t.Errorf("%q: expected no mentions, got %v", body, got)
		}
	}
}

// The dedup rule itself. A flush fires on every debounce tick, so anything
// other than "only newly-added mentions" means re-notifying on every keystroke.
func TestNewMentions_OnlyAddedOnes(t *testing.T) {
	cases := []struct {
		name       string
		prev, next string
		want       []string
	}{
		{"first mention", "", "hey [[@u1]]", []string{"u1"}},
		{"unchanged text notifies nobody", "hey [[@u1]]", "hey [[@u1]]", nil},
		{"edit elsewhere notifies nobody", "hey [[@u1]]", "hey [[@u1]] more words", nil},
		{"reformatting notifies nobody", "hey [[@u1]]", "**hey** [[@u1]]", nil},
		{"a second mention notifies only the new one", "hey [[@u1]]", "hey [[@u1]] [[@u2]]", []string{"u2"}},
		{"removing a mention notifies nobody", "hey [[@u1]] [[@u2]]", "hey [[@u1]]", nil},
		{"clearing the description notifies nobody", "hey [[@u1]]", "", nil},
		{
			"re-adding a removed mention notifies again",
			"hey", "hey [[@u1]]", []string{"u1"},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := newMentions(c.prev, c.next)
			if len(got) != len(c.want) {
				t.Fatalf("got %v, want %v", got, c.want)
			}
			for i := range c.want {
				if got[i] != c.want[i] {
					t.Fatalf("got %v, want %v", got, c.want)
				}
			}
		})
	}
}

// A server restart re-derives the previous text from the STORED description,
// tokens included — so an already-announced mention must not re-fire. This is
// the case an in-memory dedup would get wrong.
func TestNewMentions_RestartDoesNotRefire(t *testing.T) {
	stored := "spec says [[@u1]] should review"
	if got := newMentions(stored, stored); len(got) != 0 {
		t.Errorf("a flush after restart re-notified %v", got)
	}
}

// --- end-to-end through the real notify path ---

// mentionFlushEnv is a board with two members and a card, plus the
// notifications collection NotifyUser writes into.
type mentionFlushEnv struct {
	app     *tests.TestApp
	project *core.Record
	card    *core.Record
	member  *core.Record // on the board — may be notified
	visitor *core.Record // NOT on the board — must never be notified
}

func setupMentionFlushEnv(t *testing.T) *mentionFlushEnv {
	t.Helper()
	app := rlstest.NewApp(t)

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	users.Fields.Add(&core.SelectField{
		Name: "role", Required: false, MaxSelect: 1,
		Values: []string{"owner", "admin", "member", "guest"},
	})
	users.Fields.Add(&core.BoolField{Name: "disabled"})
	users.Fields.Add(&core.BoolField{Name: "is_demo"})
	if err := app.Save(users); err != nil {
		t.Fatalf("save users: %v", err)
	}

	rlstest.Apply(t, app, rlstest.MigrationsDir(t, "../pb-migrations"))

	// NotifyUser writes here; boards' own migrations do not create it (it is
	// core's), so build the shape the notify path uses.
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

	owner := cardsUser(t, app, "owner@test.local", "member")
	member := cardsUser(t, app, "member@test.local", "member")
	visitor := cardsUser(t, app, "visitor@test.local", "member")

	project := cardsProject(t, app, "Board", owner)
	cardsMember(t, app, project, owner, "owner")
	cardsMember(t, app, project, member, "editor")

	list := cardsList(t, app, project, "To do", "a0")
	card := cardsCard(t, app, project, list, "Ship the thing", "a0", owner)

	return &mentionFlushEnv{
		app: app, project: project, card: card, member: member, visitor: visitor,
	}
}

func notificationsFor(t *testing.T, app core.App, userID string) []*core.Record {
	t.Helper()
	recs, err := app.FindRecordsByFilter("notifications",
		"user = {:u}", "", 0, 0, map[string]any{"u": userID})
	if err != nil {
		t.Fatalf("find notifications: %v", err)
	}
	return recs
}

func TestDescriptionMentions_NotifiesNewlyMentionedMember(t *testing.T) {
	env := setupMentionFlushEnv(t)

	notifyDescriptionMentions(env.app, env.project.Id, env.card.Id,
		"", "please look [[@"+env.member.Id+"]]")

	got := notificationsFor(t, env.app, env.member.Id)
	if len(got) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(got))
	}
	n := got[0]
	if n.GetString("package") != "boards" {
		t.Errorf("package = %q, want cards", n.GetString("package"))
	}
	if n.GetString("type") != descriptionMentionType {
		t.Errorf("type = %q, want %q", n.GetString("type"), descriptionMentionType)
	}
	// The body answers "which card?", since the title cannot name an author.
	if n.GetString("body") != "Ship the thing" {
		t.Errorf("body = %q, want the card title", n.GetString("body"))
	}
	if want := "/boards?focused=" + env.card.Id; !containsSub(n.GetString("url"), want) {
		t.Errorf("url = %q, want it to contain %q", n.GetString("url"), want)
	}
}

// The security property: a description is collaborative text, so anyone with
// write access could type a token naming ANY user id in the deployment.
func TestDescriptionMentions_IgnoresNonMembers(t *testing.T) {
	env := setupMentionFlushEnv(t)

	notifyDescriptionMentions(env.app, env.project.Id, env.card.Id,
		"", "hello [[@"+env.visitor.Id+"]]")

	if got := notificationsFor(t, env.app, env.visitor.Id); len(got) != 0 {
		t.Errorf("a non-member was notified: %d notification(s)", len(got))
	}
}

// The behaviour that makes this liveable: a flush fires on every debounce tick.
func TestDescriptionMentions_RepeatedFlushNotifiesOnce(t *testing.T) {
	env := setupMentionFlushEnv(t)
	body := "please look [[@" + env.member.Id + "]]"

	// First flush: the mention is new.
	notifyDescriptionMentions(env.app, env.project.Id, env.card.Id, "", body)
	// Subsequent flushes: the stored text already carries the token.
	notifyDescriptionMentions(env.app, env.project.Id, env.card.Id, body, body)
	notifyDescriptionMentions(env.app, env.project.Id, env.card.Id, body, body+" thanks")

	if got := notificationsFor(t, env.app, env.member.Id); len(got) != 1 {
		t.Errorf("expected exactly 1 notification across 3 flushes, got %d", len(got))
	}
}

// An unresolvable card must not stall or panic the flush.
func TestDescriptionMentions_MissingCardStillNotifies(t *testing.T) {
	env := setupMentionFlushEnv(t)

	notifyDescriptionMentions(env.app, env.project.Id, "nonexistentcard",
		"", "ping [[@"+env.member.Id+"]]")

	got := notificationsFor(t, env.app, env.member.Id)
	if len(got) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(got))
	}
	if got[0].GetString("body") != "A card mentions you" {
		t.Errorf("body = %q, want the fallback", got[0].GetString("body"))
	}
}

// Description mentions route through the same notify.NotifyUser as comments,
// so the per-user mute applies here too. Worth asserting rather than assuming:
// this path builds its own NotifyParams, and a wrong Type string would read as
// "mute is broken" to a user who had switched cards mentions off.
func TestDescriptionMentions_RespectsMutedPreference(t *testing.T) {
	env := setupMentionFlushEnv(t)

	users, err := env.app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	prefs := core.NewBaseCollection("user_preferences")
	prefs.Fields.Add(&core.RelationField{
		Name: "user", Required: true, CollectionId: users.Id, MaxSelect: 1,
	})
	prefs.Fields.Add(&core.TextField{Name: "app"})
	prefs.Fields.Add(&core.TextField{Name: "key"})
	prefs.Fields.Add(&core.JSONField{Name: "value"})
	if err := env.app.Save(prefs); err != nil {
		t.Fatalf("save user_preferences: %v", err)
	}

	rec := core.NewRecord(prefs)
	rec.Set("user", env.member.Id)
	rec.Set("app", "notifications")
	rec.Set("key", "preferences")
	rec.Set("value", map[string]any{descriptionMentionType: false})
	if err := env.app.Save(rec); err != nil {
		t.Fatalf("save preference: %v", err)
	}

	notifyDescriptionMentions(env.app, env.project.Id, env.card.Id,
		"", "please look [[@"+env.member.Id+"]]")

	if got := notificationsFor(t, env.app, env.member.Id); len(got) != 0 {
		t.Errorf("a muted description mention was delivered: %d notification(s)", len(got))
	}
}

// A description is authored in the rich editor and serialized to MARKDOWN,
// where `[` is syntax — so the stored text carries backslash-escaped brackets.
// Matching only the bare form meant a mention typed with the picker notified
// nobody. Both spellings are the same mention.
func TestParseMentions_AcceptsMarkdownEscapedBrackets(t *testing.T) {
	got := parseMentions(`please review \[\[@u1\]\] and [[@u2]]`)
	if len(got) != 2 || got[0] != "u1" || got[1] != "u2" {
		t.Fatalf("got %v, want [u1 u2]", got)
	}
}

func TestNewMentions_EscapedAndBareAreTheSameMention(t *testing.T) {
	// Bare first, then the escaped spelling of the SAME id: nothing new.
	if got := newMentions(`hi [[@u1]]`, `hi \[\[@u1\]\]`); len(got) != 0 {
		t.Errorf("re-notified on a re-serialization: %v", got)
	}
}
