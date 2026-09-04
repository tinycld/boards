package boards

import (
	"testing"
	"time"

	"tinycld.org/core/realtime"
)

// A connection that opened before its own membership row committed must not be
// barred from writing for the rest of its life.
//
// Creating a board is a MULTI-STATEMENT flow: the project row is written first,
// the owner's membership row second, and the client navigates to the new board
// — opening the realtime socket — as soon as the first one lands. A connection
// that arrived in that window found no membership row, resolved "read-only",
// and cached it forever. Every keystroke of every description typed on that
// connection was then dropped by the write gate, silently: the client's own
// Y.Doc kept the text, so the description looked saved right up until it was
// read back from the server and came back empty.
//
// The hello is allowed to say read-only there — it is a snapshot of a moment
// when the row genuinely was not visible. What must NOT happen is the gate
// staying shut once it is.

func TestWritePredicate_RecoversWhenTheMembershipRowArrivesLate(t *testing.T) {
	env := setupCardsEnv(t)

	// A board whose project row exists but whose owner row has not been
	// written yet — exactly the window between the two inserts.
	project := cardsProject(t, env.app, "Late owner row", env.owner)

	state := newBoardDocState()
	state.open(project.Id, time.Now())
	client := realtime.NewClientForTest(env.owner.Id)

	// The socket opens inside the window.
	if _, err := makeOnConnect(env.app, state)(project.Id, client); err != nil {
		t.Fatalf("onConnect: %v", err)
	}
	if !client.ReadOnly() {
		t.Fatal("expected the early connection to resolve read-only; the test no longer covers the window it was written for")
	}

	predicate := boardWritePredicate(env.app)
	if predicate(client, project.Id) {
		t.Error("write was allowed while the member genuinely had no row")
	}

	// The second insert lands.
	cardsMember(t, env.app, project, env.owner, "owner")

	if !predicate(client, project.Id) {
		t.Error("the owner is still barred from writing after their membership row committed")
	}
	// And the correction is cached, so the gate stops paying for the lookup.
	if client.ReadOnly() {
		t.Error("the connection flag was not corrected once the row existed")
	}
}

func TestWritePredicate_KeepsRefusingARealViewer(t *testing.T) {
	// The recheck must not become a way in. A viewer's row exists and says
	// viewer, so every pass has to keep saying no.
	env := setupCardsEnv(t)

	state := newBoardDocState()
	state.open(env.project.Id, time.Now())
	client := realtime.NewClientForTest(env.viewer.Id)
	if _, err := makeOnConnect(env.app, state)(env.project.Id, client); err != nil {
		t.Fatalf("onConnect: %v", err)
	}

	predicate := boardWritePredicate(env.app)
	for i := 0; i < 3; i++ {
		if predicate(client, env.project.Id) {
			t.Fatalf("a viewer was granted write access on pass %d", i)
		}
	}
	if !client.ReadOnly() {
		t.Error("a viewer's connection flag was cleared")
	}
}

func TestWritePredicate_DoesNotRequeryAWriter(t *testing.T) {
	// An editor resolves writable at connect, and the gate must then be a
	// pure field read — this is the hot path for every keystroke in the room.
	env := setupCardsEnv(t)

	state := newBoardDocState()
	state.open(env.project.Id, time.Now())
	client := realtime.NewClientForTest(env.editor.Id)
	if _, err := makeOnConnect(env.app, state)(env.project.Id, client); err != nil {
		t.Fatalf("onConnect: %v", err)
	}
	if client.ReadOnly() {
		t.Fatal("an editor resolved read-only at connect")
	}

	// Passing a board id that does not exist proves no lookup happened: a
	// re-resolve against it would find no row and refuse.
	if !boardWritePredicate(env.app)(client, "nonexistentproj") {
		t.Error("the gate re-queried for a connection already known to be writable")
	}
}
