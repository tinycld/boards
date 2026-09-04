package boards

import (
	"testing"

	"tinycld.org/core/realtime"
)

// Presence authorization is Go, not a PB rule — a WebSocket upgrade never
// passes through the collection rules — so unlike the *_rls_test.go suites
// these bind the real registration and call the handler it registered.
//
// The room is board-scoped: roomID is a boards_projects id. Every case below is
// therefore "may this user join THIS board's room", which must line up with the
// `viaMember` fragment the collections use to decide who can read the board.

// authorizeCardsRoom registers the room kind against a fresh fixture and hands
// back the AuthorizeFn that landed in the registry. Registration panics on a
// duplicate kind, so the registry is reset first — and again on cleanup, so a
// later test in this package starts clean.
func authorizeCardsRoom(t *testing.T, env *cardsEnv) realtime.AuthorizeFn {
	t.Helper()
	realtime.ResetRegistryForTest()
	t.Cleanup(realtime.ResetRegistryForTest)

	registerRealtime(env.app)

	opts, ok := realtime.LookupOptionsForTest(roomKindBoards)
	if !ok {
		t.Fatalf("registerRealtime did not register room kind %q", roomKindBoards)
	}
	if opts.Authorize == nil {
		t.Fatal("room kind registered with a nil Authorize")
	}
	// AuthorizeShare left nil is what refuses anonymous share-link visitors
	// before they ever reach the handler, which matters because M6a will add
	// share links to this package.
	if opts.AuthorizeShare != nil {
		t.Error("board room should not admit anonymous share sessions")
	}
	// The room carries a shared document alongside presence, so the document
	// machinery has to be wired. A missing piece here is the kind of failure
	// that looks fine in a demo — edits relay between peers — and loses
	// everything the moment the last person closes the board.
	if opts.RuntimeProvider == nil {
		t.Error("board room has no document runtime; descriptions would never persist")
	}
	if opts.Journal == nil {
		t.Error("board room has no journal; an update accepted before a flush would be lost")
	}
	if opts.WritePredicate == nil {
		t.Error("board room has no write gate; a viewer could edit descriptions")
	}
	if opts.UpdateContentValidator == nil {
		t.Error("board room has no update validator; a client could write arbitrary roots")
	}
	if opts.OnConnect == nil {
		t.Error("board room sends no hello; clients could not learn their write access")
	}
	if opts.ForceFlush == nil {
		t.Error("board room cannot be force-flushed")
	}
	return opts.Authorize
}

func TestCardsRealtime_MembersMayJoinTheirBoardRoom(t *testing.T) {
	env := setupCardsEnv(t)
	authorize := authorizeCardsRoom(t, env)

	// Every project role joins, viewer included: presence is a read-level
	// affordance, and a viewer scanning a busy board wants it as much as an
	// editor does.
	for name, user := range map[string]string{
		"owner":     env.owner.Id,
		"editor":    env.editor.Id,
		"commentor": env.commentor.Id,
		"viewer":    env.viewer.Id,
	} {
		t.Run(name, func(t *testing.T) {
			record, err := env.app.FindRecordById("users", user)
			if err != nil {
				t.Fatalf("loading %s: %v", name, err)
			}
			if err := authorize(record, env.project.Id); err != nil {
				t.Errorf("%s refused from their own board's room: %v", name, err)
			}
		})
	}
}

func TestCardsRealtime_NonMemberIsRefused(t *testing.T) {
	env := setupCardsEnv(t)
	authorize := authorizeCardsRoom(t, env)

	if err := authorize(env.outsider, env.project.Id); err == nil {
		t.Error("a user with no membership joined the board's presence room")
	}
}

func TestCardsRealtime_UnauthenticatedIsRefused(t *testing.T) {
	env := setupCardsEnv(t)
	authorize := authorizeCardsRoom(t, env)

	if err := authorize(nil, env.project.Id); err == nil {
		t.Error("an unauthenticated connection joined the board's presence room")
	}
}

func TestCardsRealtime_DisabledMemberIsRefused(t *testing.T) {
	env := setupCardsEnv(t)
	authorize := authorizeCardsRoom(t, env)

	// `disabled` is conjoined into every shipped collection rule; presence has
	// to honour it too, or a disabled account keeps a live channel into a board
	// it can no longer read.
	env.owner.Set("disabled", true)
	if err := env.app.Save(env.owner); err != nil {
		t.Fatalf("disabling the owner: %v", err)
	}
	reloaded, err := env.app.FindRecordById("users", env.owner.Id)
	if err != nil {
		t.Fatalf("reloading the owner: %v", err)
	}

	if err := authorize(reloaded, env.project.Id); err == nil {
		t.Error("a disabled member joined the board's presence room")
	}
}

func TestCardsRealtime_MembershipDoesNotCarryToAnotherBoard(t *testing.T) {
	env := setupCardsEnv(t)
	authorize := authorizeCardsRoom(t, env)

	// The membership check is keyed on (project, user), so holding a row on one
	// board must not open another's room. A check that only counted the user's
	// rows anywhere would pass every other case in this file and fail here.
	other := cardsProject(t, env.app, "Someone else's board", env.outsider)

	if err := authorize(env.owner, other.Id); err == nil {
		t.Error("a member of one board joined a board they do not belong to")
	}
}
