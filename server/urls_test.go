package boards

import "testing"

// The URL shapes notifications mint. The client twin is
// tinycld/boards/lib/board-route.ts (tests/board-route.test.ts); a change to
// one side without the other is a link that lands on "no such board".
func TestCardURLSpellsTheKeyInThePath(t *testing.T) {
	env := setupMentionFlushEnv(t)
	env.project.Set("slug", "PL")
	if err := env.app.Save(env.project); err != nil {
		t.Fatalf("save project: %v", err)
	}
	env.card.Set("number", 12)
	if err := env.app.Save(env.card); err != nil {
		t.Fatalf("save card: %v", err)
	}

	got := cardURL(env.app, env.card.Id)
	want := appBase(env.app) + "/a/boards/PL-12"
	if got != want {
		t.Errorf("cardURL = %q, want %q", got, want)
	}
}

// A board with no slug has no keys; the card rides `?focused=` on the board's
// id, which is the shape core's own mention notifications use.
func TestCardURLFallsBackToFocusedParam(t *testing.T) {
	env := setupMentionFlushEnv(t)

	got := cardURL(env.app, env.card.Id)
	want := appBase(env.app) + "/a/boards/" + env.project.Id + "?focused=" + env.card.Id
	if got != want {
		t.Errorf("cardURL = %q, want %q", got, want)
	}
}

func TestCardURLOfMissingCardIsThePackageRoot(t *testing.T) {
	env := setupMentionFlushEnv(t)

	if got, want := cardURL(env.app, "nonexistentcard"), appBase(env.app)+"/a/boards"; got != want {
		t.Errorf("cardURL = %q, want %q", got, want)
	}
}

func TestBoardURLUsesSlugThenID(t *testing.T) {
	env := setupMentionFlushEnv(t)

	if got, want := boardURL(env.app, env.project), appBase(env.app)+"/a/boards/"+env.project.Id; got != want {
		t.Errorf("boardURL without slug = %q, want %q", got, want)
	}
	env.project.Set("slug", "OTTER")
	if got, want := boardURL(env.app, env.project), appBase(env.app)+"/a/boards/OTTER"; got != want {
		t.Errorf("boardURL with slug = %q, want %q", got, want)
	}
}
