package boards

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"tinycld.org/core/markdown"
	"tinycld.org/core/realtime"
	"tinycld.org/core/yjsdoc"
)

// Flush is what turns typing into stored text. These cases cover the paths that
// are invisible until they go wrong: a card nobody touched being rewritten, an
// edit made outside the room being clobbered, a deleted card wedging the retry
// loop, and one board's flush reaching into another's data.

// boardRoom spins up a runtime seeded from the fixture's cards and returns the
// pieces a flush needs. Mirrors what registerRealtime wires in production.
func boardRoom(t *testing.T, env *cardsEnv) (*yjsdoc.Runtime, *boardDocState, realtime.FlushFn, realtime.DocHandle) {
	t.Helper()
	state := newBoardDocState()
	runtime := yjsdoc.NewRuntime()
	t.Cleanup(runtime.Stop)
	runtime.SetBootstrap(makeBootstrap(env.app, state))

	handle, err := runtime.NewDoc(env.project.Id)
	if err != nil {
		t.Fatalf("open board document: %v", err)
	}
	return runtime, state, makeFlush(env.app, state), handle
}

// writeFragment edits a card's description inside the live document, the way a
// client's update would.
func writeFragment(t *testing.T, handle realtime.DocHandle, cardID, text string) {
	t.Helper()
	docHandle, ok := handle.(*yjsdoc.Handle)
	if !ok {
		t.Fatalf("unexpected handle type %T", handle)
	}
	pmJSON, err := json.Marshal(markdown.ToPM(text))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := docHandle.WithDoc(func(doc *yjsdoc.Doc) error {
		return yjsdoc.SeedFragmentFromPMJSON(doc, cardFragment(cardID), pmJSON)
	}); err != nil {
		t.Fatalf("write fragment: %v", err)
	}
}

func description(t *testing.T, env *cardsEnv, cardID string) string {
	t.Helper()
	record, err := env.app.FindRecordById("boards_cards", cardID)
	if err != nil {
		t.Fatalf("load card %s: %v", cardID, err)
	}
	return record.GetString("description")
}

func TestFlush_WritesAnEditedDescription(t *testing.T) {
	env := setupCardsEnv(t)
	_, _, flush, handle := boardRoom(t, env)

	writeFragment(t, handle, env.card.Id, "## Plan\n\nShip **it**.\n")
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}

	got := description(t, env, env.card.Id)
	if !strings.Contains(got, "## Plan") || !strings.Contains(got, "**it**") {
		t.Errorf("description did not round-trip through the document: %q", got)
	}
}

func TestFlush_LeavesAnUntouchedCardAlone(t *testing.T) {
	// The journal truncates per board, so flush walks EVERY card. Without the
	// baseline comparison this would rewrite every row on the board each time
	// anyone typed anywhere — churning the FTS index and every reader's view.
	env := setupCardsEnv(t)
	env.card.Set("description", "Original prose.")
	if err := env.app.Save(env.card); err != nil {
		t.Fatalf("seed description: %v", err)
	}
	before, err := env.app.FindRecordById("boards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	updatedBefore := before.GetDateTime("updated")

	_, _, flush, handle := boardRoom(t, env)
	// No edit at all — just a flush, as happens when another card changes.
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}

	after, err := env.app.FindRecordById("boards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if !after.GetDateTime("updated").Equal(updatedBefore) {
		t.Error("flush rewrote a card nobody edited")
	}
}

func TestFlush_PreservesAnEditMadeOutsideTheRoom(t *testing.T) {
	// Someone edits a description through the normal API while the board is
	// open but nobody is editing that card in the room. The room must not
	// overwrite it with the stale text it was seeded from.
	env := setupCardsEnv(t)
	env.card.Set("description", "Seeded text.")
	if err := env.app.Save(env.card); err != nil {
		t.Fatalf("seed: %v", err)
	}

	_, _, flush, handle := boardRoom(t, env)

	record, err := env.app.FindRecordById("boards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	record.Set("description", "Edited elsewhere.")
	if err := env.app.Save(record); err != nil {
		t.Fatalf("outside edit: %v", err)
	}

	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}
	if got := description(t, env, env.card.Id); got != "Edited elsewhere." {
		t.Errorf("the room clobbered an edit it never made: %q", got)
	}
}

func TestFlush_SkipsACardFromAnotherBoard(t *testing.T) {
	// The write gate is board-level, so a crafted client could create a
	// `card:<id>` fragment naming a card on a DIFFERENT board. Flushing it
	// would let any member of this board write to that one.
	env := setupCardsEnv(t)
	otherProject := cardsProject(t, env.app, "Other board", env.owner)
	otherList := cardsList(t, env.app, otherProject, "To do", "a0")
	foreign := cardsCard(t, env.app, otherProject, otherList, "foreign-card", "a0", env.owner)
	foreign.Set("description", "Untouched.")
	if err := env.app.Save(foreign); err != nil {
		t.Fatalf("seed foreign card: %v", err)
	}

	_, _, flush, handle := boardRoom(t, env)
	writeFragment(t, handle, foreign.Id, "Injected by another board.\n")

	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}
	if got := description(t, env, foreign.Id); got != "Untouched." {
		t.Errorf("a board's flush wrote to another board's card: %q", got)
	}
}

func TestFlush_SkipsADeletedCard(t *testing.T) {
	// A card deleted mid-session must not fail the flush forever — every other
	// card on the board depends on that flush succeeding to truncate the WAL.
	env := setupCardsEnv(t)
	_, _, flush, handle := boardRoom(t, env)
	writeFragment(t, handle, env.card.Id, "About to vanish.\n")

	record, err := env.app.FindRecordById("boards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if err := env.app.Delete(record); err != nil {
		t.Fatalf("delete: %v", err)
	}

	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Errorf("a deleted card failed the whole board's flush: %v", err)
	}
}

func TestFlush_ClampsAnOversizeDescription(t *testing.T) {
	// The field has a hard max. The client stops typing first, but a document
	// that arrived oversize must not make the board's flush fail forever.
	env := setupCardsEnv(t)
	_, _, flush, handle := boardRoom(t, env)
	writeFragment(t, handle, env.card.Id, strings.Repeat("x", descriptionRuneLimit+500))

	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}
	if got := len([]rune(description(t, env, env.card.Id))); got > descriptionRuneLimit {
		t.Errorf("stored %d runes, over the %d limit", got, descriptionRuneLimit)
	}
}

func TestFlush_IsIdempotent(t *testing.T) {
	// The coordinator retries a failed flush, and a retry must not rewrite the
	// rows that already landed.
	env := setupCardsEnv(t)
	_, _, flush, handle := boardRoom(t, env)
	writeFragment(t, handle, env.card.Id, "Saved once.\n")

	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("first flush: %v", err)
	}
	first, err := env.app.FindRecordById("boards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	stamp := first.GetDateTime("updated")

	time.Sleep(1100 * time.Millisecond) // the timestamp has second resolution
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("second flush: %v", err)
	}
	second, err := env.app.FindRecordById("boards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if !second.GetDateTime("updated").Equal(stamp) {
		t.Error("a repeat flush rewrote an unchanged card")
	}
}

func TestBootstrap_SeedsExistingDescriptions(t *testing.T) {
	// The first joiner must see the prose that is already stored, or their
	// first keystroke would replace it with an empty document.
	env := setupCardsEnv(t)
	env.card.Set("description", "## Existing\n\nAlready written.")
	if err := env.app.Save(env.card); err != nil {
		t.Fatalf("seed: %v", err)
	}

	_, _, _, handle := boardRoom(t, env)
	docHandle, ok := handle.(*yjsdoc.Handle)
	if !ok {
		t.Fatalf("unexpected handle type %T", handle)
	}

	var seeded string
	if err := docHandle.WithDoc(func(doc *yjsdoc.Doc) error {
		pmJSON, err := yjsdoc.PMJSONFromFragment(doc, cardFragment(env.card.Id))
		if err != nil {
			return err
		}
		var pm markdown.PMNode
		if err := json.Unmarshal(pmJSON, &pm); err != nil {
			return err
		}
		seeded = markdown.FromPM(&pm)
		return nil
	}); err != nil {
		t.Fatalf("read seeded fragment: %v", err)
	}

	if !strings.Contains(seeded, "Already written.") {
		t.Errorf("the stored description was not seeded into the document: %q", seeded)
	}
}

func TestBootstrap_ThenFlushIsANoOp(t *testing.T) {
	// Opening a board and closing it without typing must not rewrite anything.
	// This is the case that catches a baseline recorded from RAW stored text
	// rather than from serialized output: the two differ harmlessly (escapes,
	// table padding), so the wrong choice makes every card look dirty.
	env := setupCardsEnv(t)
	env.card.Set("description", "Timings: ~2s and a | pipe.\n\n| a | b |\n| - | - |\n| 1 | 2 |")
	if err := env.app.Save(env.card); err != nil {
		t.Fatalf("seed: %v", err)
	}
	before, err := env.app.FindRecordById("boards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	stamp := before.GetDateTime("updated")

	_, _, flush, handle := boardRoom(t, env)
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}

	after, err := env.app.FindRecordById("boards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if !after.GetDateTime("updated").Equal(stamp) {
		t.Errorf("opening a board rewrote a card nobody edited: %q", after.GetString("description"))
	}
}
