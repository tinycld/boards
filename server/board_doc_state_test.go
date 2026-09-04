package boards

import (
	"testing"
	"time"
)

// The baseline map decides which cards a flush writes. Getting it wrong is not
// a cosmetic bug: too eager and every save rewrites every card on the board
// (churning the FTS index and every collaborator's view), too lazy and an edit
// is silently dropped.

func TestBaseline_UnknownCardIsTreatedAsEmpty(t *testing.T) {
	state := newBoardDocState()
	state.open("board", time.Now())

	// A card created while the room is live has no baseline. Its empty
	// fragment must compare EQUAL to empty, so an untouched new card is not
	// written on every flush...
	if !state.matchesBaseline("board", "fresh", "\n") && !state.matchesBaseline("board", "fresh", "") {
		t.Error("an unknown card with no content should match the empty baseline")
	}
	// ...but its first real edit must not be skipped.
	if state.matchesBaseline("board", "fresh", "Typed something.\n") {
		t.Error("an unknown card with content should not match the empty baseline")
	}
}

func TestBaseline_TracksTheLastSavedText(t *testing.T) {
	state := newBoardDocState()
	state.open("board", time.Now())
	state.setBaseline("board", "card", "First version.\n")

	if !state.matchesBaseline("board", "card", "First version.\n") {
		t.Error("unchanged text should match its baseline")
	}
	if state.matchesBaseline("board", "card", "Second version.\n") {
		t.Error("changed text should not match the old baseline")
	}

	state.setBaseline("board", "card", "Second version.\n")
	if !state.matchesBaseline("board", "card", "Second version.\n") {
		t.Error("baseline did not advance after a save")
	}
}

func TestBaseline_IsPerBoard(t *testing.T) {
	// Two boards can hold cards with identical text; a save on one must not
	// convince the other that its card is clean.
	state := newBoardDocState()
	state.open("a", time.Now())
	state.open("b", time.Now())
	state.setBaseline("a", "card", "shared text\n")

	if state.matchesBaseline("b", "card", "shared text\n") {
		t.Error("a baseline leaked between boards")
	}
}

func TestBaseline_ClosedBoardMatchesNothing(t *testing.T) {
	// After the room is dropped there is nothing to compare against, so a late
	// flush must write rather than assume clean.
	state := newBoardDocState()
	state.open("board", time.Now())
	state.setBaseline("board", "card", "text\n")
	state.drop("board")

	if state.matchesBaseline("board", "card", "text\n") {
		t.Error("a dropped board should not report content as unchanged")
	}
}

func TestBaseline_ForgetCardStopsRetrying(t *testing.T) {
	// A deleted card's baseline is dropped so the flush loop does not keep
	// trying to save a row that is gone.
	state := newBoardDocState()
	state.open("board", time.Now())
	state.setBaseline("board", "card", "text\n")
	state.forgetCard("board", "card")

	if !state.matchesBaseline("board", "card", "") {
		t.Error("a forgotten card should fall back to the empty baseline")
	}
}

func TestEpoch_ChangesWhenARoomReopens(t *testing.T) {
	// A client reconnecting with state from a previous incarnation must be
	// told to discard it: y-crdt mints a fresh clientID per document, so
	// merging across epochs duplicates content instead of converging.
	state := newBoardDocState()
	first := state.open("board", time.UnixMilli(1_000))
	state.drop("board")
	second := state.open("board", time.UnixMilli(2_000))

	if first == second {
		t.Errorf("epoch did not change across reopen: %d", first)
	}
	if got := state.epochOf("board"); got != second {
		t.Errorf("epochOf = %d, want %d", got, second)
	}
	state.drop("board")
	if got := state.epochOf("board"); got != 0 {
		t.Errorf("a closed board should report no epoch, got %d", got)
	}
}
