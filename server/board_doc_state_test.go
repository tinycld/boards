package boards

import (
	"testing"
)

// The baseline map decides which cards a flush writes. Getting it wrong is not
// a cosmetic bug: too eager and every save rewrites every card on the board
// (churning the FTS index and every collaborator's view), too lazy and an edit
// is silently dropped.

func TestBaseline_UnknownCardIsTreatedAsEmpty(t *testing.T) {
	state := newBoardDocState()
	state.open("board")

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
	state.open("board")
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
	state.open("a")
	state.open("b")
	state.setBaseline("a", "card", "shared text\n")

	if state.matchesBaseline("b", "card", "shared text\n") {
		t.Error("a baseline leaked between boards")
	}
}

func TestBaseline_ClosedBoardMatchesNothing(t *testing.T) {
	// After the room is dropped there is nothing to compare against, so a late
	// flush must write rather than assume clean.
	state := newBoardDocState()
	state.open("board")
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
	state.open("board")
	state.setBaseline("board", "card", "text\n")
	state.forgetCard("board", "card")

	if !state.matchesBaseline("board", "card", "") {
		t.Error("a forgotten card should fall back to the empty baseline")
	}
}

// The fingerprint is how the broker tells a parked or stored document from
// the records: equal baselines, equal fingerprint; a card written outside
// the room, a different one.
func TestFingerprint_FollowsTheBaselines(t *testing.T) {
	state := newBoardDocState()
	if _, ok := state.fingerprint("board"); ok {
		t.Fatal("a board with no document reported a fingerprint")
	}
	state.open("board")
	empty, _ := state.fingerprint("board")
	state.setBaseline("board", "a", "First.\n")
	state.setBaseline("board", "b", "Second.\n")
	withTwo, _ := state.fingerprint("board")
	if withTwo == empty {
		t.Fatal("baselines did not change the fingerprint")
	}
	// Order of insertion must not matter.
	other := newBoardDocState()
	other.open("board")
	other.setBaseline("board", "b", "Second.\n")
	other.setBaseline("board", "a", "First.\n")
	if got, _ := other.fingerprint("board"); got != withTwo {
		t.Fatal("the same baselines in another order hashed differently")
	}
	// A card whose description is empty counts as absent, as it is for the
	// bootstrap query that seeds only non-empty descriptions.
	state.setBaseline("board", "c", "")
	if got, _ := state.fingerprint("board"); got != withTwo {
		t.Fatal("an empty description changed the fingerprint")
	}
	state.drop("board")
	if _, ok := state.fingerprint("board"); ok {
		t.Fatal("a dropped board still reported a fingerprint")
	}
}
