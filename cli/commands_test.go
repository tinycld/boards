package cli

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"
)

// board builds the standard fixture:
//
//	"Product launch" (prjA)
//	  To do   — "Write copy", "Book venue"
//	  Doing   — "Design deck"
//	  Done    — (empty)
//	"Home projects" (prjB)
//	  Someday — "Fix the fence"
func board(t *testing.T) *fakeCards {
	f := newFakeCards(t)
	f.addProject("prjA", "Product launch")
	f.addProject("prjB", "Home projects")

	f.addList("lstTodo", "prjA", "To do", "a0")
	f.addList("lstDoing", "prjA", "Doing", "a1")
	f.addList("lstDone", "prjA", "Done", "a2")
	f.addList("lstSomeday", "prjB", "Someday", "a0")

	f.addCard("crdCopy", "prjA", "lstTodo", "Write copy", "a0")
	f.addCard("crdVenue", "prjA", "lstTodo", "Book venue", "a1")
	f.addCard("crdDeck", "prjA", "lstDoing", "Design deck", "a0")
	f.addCard("crdFence", "prjB", "lstSomeday", "Fix the fence", "a0")

	f.users["user1"] = &user{ID: "user1", Email: "nathan@example.com", FirstName: "Nathan"}
	return f
}

func TestBoardList(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	out, _, err := runCmd(t, c, "cards", "board", "list")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Product launch", "Home projects", "prjA"} {
		if !strings.Contains(out, want) {
			t.Errorf("board list missing %q:\n%s", want, out)
		}
	}
}

// An archived board is hidden unless --all. Someone listing boards wants
// active work, matching the search source's ExcludeField: 'archived'.
func TestBoardListHidesArchivedUnlessAll(t *testing.T) {
	f := board(t)
	f.projects["prjB"].Archived = true
	_, c := f.serve()

	out, _, err := runCmd(t, c, "cards", "board", "list")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "Home projects") {
		t.Errorf("archived board listed without --all:\n%s", out)
	}
	out, _, err = runCmd(t, c, "cards", "board", "list", "--all")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "Home projects") {
		t.Errorf("--all did not include the archived board:\n%s", out)
	}
}

// A board resolves by id OR name — the sidebar shows names, never ids, so
// requiring an id would mean opening the app to use the CLI.
func TestBoardResolvesByIDAndName(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	for _, ref := range []string{"prjA", "Product launch", "product launch"} {
		out, _, err := runCmd(t, c, "cards", "board", "view", ref)
		if err != nil {
			t.Fatalf("board view %q: %v", ref, err)
		}
		if !strings.Contains(out, "Write copy") {
			t.Errorf("board view %q did not render the board:\n%s", ref, out)
		}
	}
}

// Two boards sharing a name must ERROR listing the candidates, never pick one.
// Acting on whichever sorted first is how a CLI edits the wrong thing.
func TestAmbiguousBoardNameIsRefused(t *testing.T) {
	f := board(t)
	f.addProject("prjC", "Product launch")
	_, c := f.serve()

	_, _, err := runCmd(t, c, "cards", "board", "view", "Product launch")
	if err == nil {
		t.Fatal("an ambiguous board name was silently resolved")
	}
	for _, want := range []string{"ambiguous", "prjA", "prjC"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q should mention %q", err, want)
		}
	}
	// The id still works — an ambiguous NAME must not make the board
	// unreachable.
	if _, _, err := runCmd(t, c, "cards", "board", "view", "prjA"); err != nil {
		t.Errorf("id lookup broke under an ambiguous name: %v", err)
	}
}

func TestBoardViewShowsColumnsAndCards(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	out, _, err := runCmd(t, c, "cards", "board", "view", "prjA")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"To do", "Write copy", "Book venue", "Doing", "Design deck", "Done"} {
		if !strings.Contains(out, want) {
			t.Errorf("board view missing %q:\n%s", want, out)
		}
	}
	// Another board's cards must not leak in.
	if strings.Contains(out, "Fix the fence") {
		t.Errorf("board view leaked another board's card:\n%s", out)
	}
}

func TestCardAddAppendsAndPinsProject(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	_, _, err := runCmd(t, c, "cards", "card", "add", "Ship it", "--board", "prjA", "--list", "To do")
	if err != nil {
		t.Fatal(err)
	}
	body := f.lastCardCreate
	if body == nil {
		t.Fatal("no create was sent")
	}
	// `project` is denormalized onto the card so the access rules can resolve
	// membership without a two-hop back-relation. A create without it is
	// refused by the rule, so its absence here is a real bug, not a cosmetic
	// one.
	if body["project"] != "prjA" {
		t.Errorf("create body project = %v, want prjA (the rules read it)", body["project"])
	}
	if body["list"] != "lstTodo" {
		t.Errorf("create body list = %v, want lstTodo", body["list"])
	}
	if body["created_by"] != "user1" {
		t.Errorf("create body created_by = %v, want user1", body["created_by"])
	}
	// Appended: after "a0" and "a1".
	pos, _ := body["position"].(string)
	if pos <= "a1" {
		t.Errorf("position %q does not sort after the last card (a1)", pos)
	}
}

func TestCardAddAtIndex(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	_, _, err := runCmd(t, c, "cards", "card", "add", "First", "--board", "prjA", "--list", "To do", "--index", "0")
	if err != nil {
		t.Fatal(err)
	}
	pos, _ := f.lastCardCreate["position"].(string)
	if pos >= "a0" {
		t.Errorf("--index 0 gave %q, want it to sort before the first card (a0)", pos)
	}
}

func TestCardAddRejectsABadDueDate(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	_, _, err := runCmd(t, c, "cards", "card", "add", "X", "--board", "prjA", "--list", "To do", "--due", "next tuesday")
	if err == nil {
		t.Fatal("a non-date --due was accepted")
	}
	if !strings.Contains(err.Error(), "YYYY-MM-DD") {
		t.Errorf("error should name the expected format, got %q", err)
	}
}

func TestCardAddRequiresBoardAndList(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	if _, _, err := runCmd(t, c, "cards", "card", "add", "X", "--list", "To do"); err == nil {
		t.Error("card add without --board succeeded")
	}
	if _, _, err := runCmd(t, c, "cards", "card", "add", "X", "--board", "prjA"); err == nil {
		t.Error("card add without --list succeeded")
	}
}

// A move writes BOTH fields in one PATCH. Two calls would leave the card
// momentarily in the target column at its old rank — visible to every other
// client, and permanent if the second call failed.
func TestCardMoveWritesListAndPositionInOneUpdate(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	before := f.patchCount
	_, _, err := runCmd(t, c, "cards", "card", "move", "crdCopy", "--list", "Doing")
	if err != nil {
		t.Fatal(err)
	}
	if got := f.patchCount - before; got != 1 {
		t.Errorf("move sent %d PATCHes, want exactly 1", got)
	}
	body := f.lastCardPatch
	if body["list"] != "lstDoing" {
		t.Errorf("patch list = %v, want lstDoing", body["list"])
	}
	if _, ok := body["position"].(string); !ok {
		t.Error("patch carried no position — a move must rewrite the rank too")
	}
}

// Moving within a column must exclude the mover before indexing, or every
// downward move is off by one and a move-in-place computes the card's own rank.
func TestCardMoveWithinAColumnExcludesTheMover(t *testing.T) {
	f := board(t)
	// Three cards so an index has somewhere to land.
	f.addCard("crdThird", "prjA", "lstTodo", "Third", "a2")
	_, c := f.serve()

	// Move the FIRST card to the end.
	_, _, err := runCmd(t, c, "cards", "card", "move", "crdCopy", "--index", "2")
	if err != nil {
		t.Fatal(err)
	}
	pos := f.cards["crdCopy"].Position
	if pos <= f.cards["crdThird"].Position {
		t.Errorf("moved card position %q does not sort after the last remaining card %q "+
			"— the mover was probably left in the sibling list",
			pos, f.cards["crdThird"].Position)
	}
}

func TestCardMoveRequiresSomethingToDo(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	if _, _, err := runCmd(t, c, "cards", "card", "move", "crdCopy"); err == nil {
		t.Error("a move with neither --list nor --index succeeded")
	}
}

// A card names its own board, so --board is only for resolving a list NAME and
// must agree. Letting the two disagree is how a command acts on another board.
func TestCardMoveRefusesAMismatchedBoard(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	_, _, err := runCmd(t, c, "cards", "card", "move", "crdCopy", "--board", "Home projects", "--list", "Someday")
	if err == nil {
		t.Fatal("moving a card onto another board's list was allowed")
	}
	if !strings.Contains(err.Error(), "not on board") {
		t.Errorf("error should say the card is not on that board, got %q", err)
	}
}

func TestCardEditOnlySendsChangedFields(t *testing.T) {
	f := board(t)
	f.cards["crdCopy"].Description = "keep me"
	_, c := f.serve()

	_, _, err := runCmd(t, c, "cards", "card", "edit", "crdCopy", "--title", "New title")
	if err != nil {
		t.Fatal(err)
	}
	if _, sent := f.lastCardPatch["description"]; sent {
		t.Error("edit sent `description` when only --title was passed — it would " +
			"blank a description the caller never mentioned")
	}
	if f.cards["crdCopy"].Description != "keep me" {
		t.Errorf("description was clobbered: %q", f.cards["crdCopy"].Description)
	}
	if f.cards["crdCopy"].Title != "New title" {
		t.Errorf("title = %q, want %q", f.cards["crdCopy"].Title, "New title")
	}
}

func TestCardEditRequiresAChange(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	if _, _, err := runCmd(t, c, "cards", "card", "edit", "crdCopy"); err == nil {
		t.Error("an edit with no flags succeeded")
	}
}

func TestCardEditDueAndClearDue(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "cards", "card", "edit", "crdCopy", "--due", "2026-09-01"); err != nil {
		t.Fatal(err)
	}
	if got := f.cards["crdCopy"].Due; !strings.HasPrefix(got, "2026-09-01") {
		t.Errorf("due = %q, want it to start with 2026-09-01", got)
	}
	if _, _, err := runCmd(t, c, "cards", "card", "edit", "crdCopy", "--clear-due"); err != nil {
		t.Fatal(err)
	}
	if got := f.cards["crdCopy"].Due; got != "" {
		t.Errorf("due = %q after --clear-due, want empty", got)
	}
	// The two contradict each other and must not silently pick one.
	if _, _, err := runCmd(t, c, "cards", "card", "edit", "crdCopy",
		"--due", "2026-09-01", "--clear-due"); err == nil {
		t.Error("--due together with --clear-due was accepted")
	}
}

func TestCardEditReporterAndClearReporter(t *testing.T) {
	f := board(t)
	f.users["user2"] = &user{ID: "user2", Email: "sam@example.com", FirstName: "Sam"}
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "cards", "card", "edit", "crdCopy", "--reporter", "user2"); err != nil {
		t.Fatal(err)
	}
	if got := f.cards["crdCopy"].Reporter; got != "user2" {
		t.Errorf("reporter = %q, want user2", got)
	}
	// Clearing restores the created_by fallback rather than emptying the row,
	// which is why the flag is named for the effect and not for the field.
	if _, _, err := runCmd(t, c, "cards", "card", "edit", "crdCopy", "--clear-reporter"); err != nil {
		t.Fatal(err)
	}
	if got := f.cards["crdCopy"].Reporter; got != "" {
		t.Errorf("reporter = %q after --clear-reporter, want empty", got)
	}
	if _, _, err := runCmd(t, c, "cards", "card", "edit", "crdCopy",
		"--reporter", "user2", "--clear-reporter"); err == nil {
		t.Error("--reporter together with --clear-reporter was accepted")
	}
	// An empty --reporter is indistinguishable from an unpassed one, so it must
	// be refused rather than silently clearing the field.
	if _, _, err := runCmd(t, c, "cards", "card", "edit", "crdCopy", "--reporter", ""); err == nil {
		t.Error("an empty --reporter was accepted")
	}
}

// No server hook fills the reporter in, so the CLI has to write it on create —
// otherwise a card added from the terminal would report to nobody until someone
// opened it in the app.
func TestCardAddDefaultsReporterToCaller(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "cards", "card", "add", "Ship it",
		"--board", "prjA", "--list", "lstTodo"); err != nil {
		t.Fatal(err)
	}
	if got := str(f.lastCardCreate["reporter"]); got == "" {
		t.Error("card add wrote no reporter")
	} else if got != str(f.lastCardCreate["created_by"]) {
		t.Errorf("reporter = %q, want it to match created_by %q",
			got, str(f.lastCardCreate["created_by"]))
	}

	// Filing on someone else's behalf is the case the field exists for.
	if _, _, err := runCmd(t, c, "cards", "card", "add", "For Sam",
		"--board", "prjA", "--list", "lstTodo", "--reporter", "user2"); err != nil {
		t.Fatal(err)
	}
	if got := str(f.lastCardCreate["reporter"]); got != "user2" {
		t.Errorf("reporter = %q, want user2", got)
	}
	if got := str(f.lastCardCreate["created_by"]); got == "user2" {
		t.Error("--reporter overwrote created_by; provenance must record the actual caller")
	}
}

// The view falls back to created_by, so a card nobody has explicitly assigned a
// reporter to still names someone — the behaviour that makes the field useful
// on rows that predate it.
func TestCardViewFallsBackToCreator(t *testing.T) {
	f := board(t)
	f.cards["crdCopy"].CreatedBy = "user1"
	f.cards["crdCopy"].Reporter = ""
	_, c := f.serve()

	out, _, err := runCmd(t, c, "cards", "card", "view", "crdCopy")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "Reporter") || !strings.Contains(out, "Nathan") {
		t.Errorf("card view did not report the creator:\n%s", out)
	}
}

func TestCardArchiveAndRestore(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "cards", "card", "archive", "crdCopy"); err != nil {
		t.Fatal(err)
	}
	if !f.cards["crdCopy"].Archived {
		t.Error("card was not archived")
	}
	// An archived card drops out of a board view...
	out, _, err := runCmd(t, c, "cards", "board", "view", "prjA")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "Write copy") {
		t.Errorf("archived card still listed:\n%s", out)
	}
	// ...but --all shows it.
	out, _, err = runCmd(t, c, "cards", "board", "view", "prjA", "--all")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "Write copy") {
		t.Errorf("--all did not include the archived card:\n%s", out)
	}

	if _, _, err := runCmd(t, c, "cards", "card", "archive", "crdCopy", "--unset"); err != nil {
		t.Fatal(err)
	}
	if f.cards["crdCopy"].Archived {
		t.Error("--unset did not restore the card")
	}
}

// Deleting a card destroys its checklist, comments and attachments. It must
// not happen without --yes, and archive must be offered as the reversible
// alternative.
func TestCardRemoveNeedsConfirmation(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	_, _, err := runCmd(t, c, "cards", "card", "remove", "crdCopy")
	if err == nil {
		t.Fatal("a card was deleted without --yes")
	}
	if !strings.Contains(err.Error(), "archive") {
		t.Errorf("the refusal should point at archive as the reversible option, got %q", err)
	}
	if len(f.deletedCards) != 0 {
		t.Fatalf("a DELETE was sent despite the refusal: %v", f.deletedCards)
	}
	if _, ok := f.cards["crdCopy"]; !ok {
		t.Fatal("the card is gone despite the refusal")
	}

	if _, _, err := runCmd(t, c, "cards", "card", "remove", "crdCopy", "--yes"); err != nil {
		t.Fatal(err)
	}
	if _, ok := f.cards["crdCopy"]; ok {
		t.Error("--yes did not delete the card")
	}
}

func TestListShowAndAdd(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	out, _, err := runCmd(t, c, "cards", "list", "show", "--board", "prjA")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"To do", "Doing", "Done"} {
		if !strings.Contains(out, want) {
			t.Errorf("list show missing %q:\n%s", want, out)
		}
	}

	if _, _, err := runCmd(t, c, "cards", "list", "add", "Blocked", "--board", "prjA"); err != nil {
		t.Fatal(err)
	}
	var added *list
	for _, l := range f.lists {
		if l.Name == "Blocked" {
			added = l
		}
	}
	if added == nil {
		t.Fatal("the list was not created")
	}
	if added.Project != "prjA" {
		t.Errorf("new list project = %q, want prjA", added.Project)
	}
	if added.Position <= "a2" {
		t.Errorf("new list position %q does not sort after the last column (a2)", added.Position)
	}
}

func TestListRenameAndDoneFlag(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "cards", "list", "rename", "To do", "Backlog", "--board", "prjA"); err != nil {
		t.Fatal(err)
	}
	if f.lists["lstTodo"].Name != "Backlog" {
		t.Errorf("name = %q, want Backlog", f.lists["lstTodo"].Name)
	}

	if _, _, err := runCmd(t, c, "cards", "list", "done", "Done", "--board", "prjA"); err != nil {
		t.Fatal(err)
	}
	if !f.lists["lstDone"].IsDone {
		t.Error("is_done was not set")
	}
	if _, _, err := runCmd(t, c, "cards", "list", "done", "Done", "--board", "prjA", "--unset"); err != nil {
		t.Fatal(err)
	}
	if f.lists["lstDone"].IsDone {
		t.Error("--unset did not clear is_done")
	}
}

func TestListMoveReordersColumns(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	// Send the first column to the end.
	if _, _, err := runCmd(t, c, "cards", "list", "move", "To do", "2", "--board", "prjA"); err != nil {
		t.Fatal(err)
	}
	if got := f.lists["lstTodo"].Position; got <= f.lists["lstDone"].Position {
		t.Errorf("moved column position %q does not sort after %q",
			got, f.lists["lstDone"].Position)
	}
}

func TestListMoveRejectsANonNumericIndex(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	if _, _, err := runCmd(t, c, "cards", "list", "move", "To do", "last", "--board", "prjA"); err == nil {
		t.Error("a non-numeric index was accepted")
	}
}

// cards_cards.list ships cascadeDelete: true, so deleting a column deletes its
// cards server-side. The confirm must NAME THE COUNT — a delete that silently
// destroys seven cards because the cascade was invisible is the failure mode.
func TestListRemoveWarnsAboutTheCascade(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	_, _, err := runCmd(t, c, "cards", "list", "remove", "To do", "--board", "prjA")
	if err == nil {
		t.Fatal("a column with cards was deleted without --yes")
	}
	if !strings.Contains(err.Error(), "2 card") {
		t.Errorf("the refusal must name the card count, got %q", err)
	}
	if len(f.deletedLists) != 0 {
		t.Fatalf("a DELETE was sent despite the refusal: %v", f.deletedLists)
	}

	if _, _, err := runCmd(t, c, "cards", "list", "remove", "To do", "--board", "prjA", "--yes"); err != nil {
		t.Fatal(err)
	}
	if _, ok := f.lists["lstTodo"]; ok {
		t.Error("--yes did not delete the column")
	}
	// The cascade took the cards with it.
	if _, ok := f.cards["crdCopy"]; ok {
		t.Error("the column's cards survived the cascade")
	}
}

// An EMPTY column needs no confirmation — there is nothing to lose, and a
// prompt for a no-risk action trains people to pass --yes reflexively.
func TestListRemoveSkipsTheConfirmWhenEmpty(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	if _, _, err := runCmd(t, c, "cards", "list", "remove", "Done", "--board", "prjA"); err != nil {
		t.Fatalf("deleting an empty column required confirmation: %v", err)
	}
	if _, ok := f.lists["lstDone"]; ok {
		t.Error("the empty column was not deleted")
	}
}

// The count in the confirm includes ARCHIVED cards: the cascade does not care,
// so a count of active cards alone would understate what is destroyed.
func TestListRemoveCountsArchivedCards(t *testing.T) {
	f := board(t)
	f.cards["crdCopy"].Archived = true
	f.cards["crdVenue"].Archived = true
	_, c := f.serve()

	_, _, err := runCmd(t, c, "cards", "list", "remove", "To do", "--board", "prjA")
	if err == nil {
		t.Fatal("a column holding archived cards was deleted without --yes")
	}
	if !strings.Contains(err.Error(), "2 card") {
		t.Errorf("archived cards must be counted in the warning, got %q", err)
	}
}

func TestCardViewRendersChecklistAndComments(t *testing.T) {
	f := board(t)
	f.checklist["chk1"] = &checklistItem{ID: "chk1", Card: "crdCopy", Title: "Draft headline", Position: "a0"}
	f.checklist["chk2"] = &checklistItem{ID: "chk2", Card: "crdCopy", Title: "Proofread", IsDone: true, Position: "a1"}
	f.comments["cmt1"] = &comment{ID: "cmt1", Card: "crdCopy", Author: "user1", Body: "Looks good", Created: "2026-08-01"}
	f.labels["lbl1"] = &label{ID: "lbl1", Project: "prjA", Name: "urgent", Color: "#f00"}
	f.cards["crdCopy"].Labels = []string{"lbl1"}
	f.cards["crdCopy"].Assignees = []string{"user1"}
	_, c := f.serve()

	out, _, err := runCmd(t, c, "cards", "card", "view", "crdCopy")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Write copy", "Draft headline", "Proofread", "Looks good", "urgent", "Nathan"} {
		if !strings.Contains(out, want) {
			t.Errorf("card view missing %q:\n%s", want, out)
		}
	}
}

// A label id with no readable row is DROPPED (matching toBoardCard, since
// deleting a label leaves its id on cards), but an ASSIGNEE that cannot be
// read renders as a placeholder — a card assigned to someone must never read
// as UNASSIGNED, which says something false about who owns the work.
func TestUnreadableAssigneeRendersAsAPlaceholder(t *testing.T) {
	f := board(t)
	f.cards["crdCopy"].Assignees = []string{"ghostUser"}
	f.cards["crdCopy"].Labels = []string{"ghostLabel"}
	_, c := f.serve()

	out, _, err := runCmd(t, c, "cards", "card", "view", "crdCopy")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "?") {
		t.Errorf("an unreadable assignee must not vanish — the card would read "+
			"as unassigned:\n%s", out)
	}
}

// --json must emit the typed record, not the table cosmetics: it is the
// contract a script depends on.
func TestJSONOutputIsTheRecord(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	out, _, err := runCmd(t, c, "cards", "board", "list", "--json")
	if err != nil {
		t.Fatal(err)
	}
	var projects []project
	if err := json.Unmarshal([]byte(out), &projects); err != nil {
		t.Fatalf("--json did not emit a project array: %v\n%s", err, out)
	}
	if len(projects) != 2 || projects[0].ID == "" {
		t.Errorf("unexpected --json payload: %+v", projects)
	}
}

// Info chatter goes to STDERR so `--json` stdout stays machine-readable. A
// status line mixed into stdout breaks every caller piping to jq.
func TestInfoChatterStaysOffStdout(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	out, errOut, err := runCmd(t, c, "cards", "card", "add", "Ship it",
		"--board", "prjA", "--list", "To do", "--json")
	if err != nil {
		t.Fatal(err)
	}
	var created card
	if err := json.Unmarshal([]byte(out), &created); err != nil {
		t.Fatalf("stdout was not clean JSON: %v\n%s", err, out)
	}
	if !strings.Contains(errOut, "added") {
		t.Errorf("the status line should be on stderr, got %q", errOut)
	}
}

func TestUnknownBoardAndCardAreReported(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	if _, _, err := runCmd(t, c, "cards", "board", "view", "Nope"); err == nil {
		t.Error("an unknown board did not error")
	}
	if _, _, err := runCmd(t, c, "cards", "card", "view", "crdNope"); err == nil {
		t.Error("an unknown card did not error")
	}
}

// A list name is resolved WITHIN a board, so the same "Done" on two boards is
// never ambiguous.
func TestListNamesAreScopedToTheirBoard(t *testing.T) {
	f := board(t)
	f.addList("lstDoneB", "prjB", "Done", "a1")
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "cards", "list", "rename", "Done", "Shipped", "--board", "prjA"); err != nil {
		t.Fatalf("a same-named list on another board made this ambiguous: %v", err)
	}
	if f.lists["lstDone"].Name != "Shipped" {
		t.Error("the wrong board's list was renamed")
	}
	if f.lists["lstDoneB"].Name != "Done" {
		t.Error("the other board's list was modified")
	}
}

// Two columns sharing a name on ONE board is genuinely ambiguous and must be
// refused rather than guessed.
func TestAmbiguousListNameOnOneBoardIsRefused(t *testing.T) {
	f := board(t)
	f.addList("lstTodo2", "prjA", "To do", "a3")
	_, c := f.serve()
	_, _, err := runCmd(t, c, "cards", "list", "rename", "To do", "X", "--board", "prjA")
	if err == nil {
		t.Fatal("an ambiguous list name was silently resolved")
	}
	if !strings.Contains(err.Error(), "ambiguous") {
		t.Errorf("error should say ambiguous, got %q", err)
	}
}

// The board view reads every column's cards in ONE request. A read per column
// is ten sequential round trips on a ten-column board, and `project` is
// denormalized onto the card precisely so it does not have to be.
func TestBoardViewReadsCardsInOneRequest(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	before := f.cardListCount
	out, _, err := runCmd(t, c, "cards", "board", "view", "prjA")
	if err != nil {
		t.Fatal(err)
	}
	if got := f.cardListCount - before; got != 1 {
		t.Errorf("board view issued %d cards_cards list reads, want exactly 1", got)
	}
	// The single read must still produce the same board.
	for _, want := range []string{"Write copy", "Book venue", "Design deck"} {
		if !strings.Contains(out, want) {
			t.Errorf("board view lost %q when it stopped reading per column:\n%s", want, out)
		}
	}
	// A card on ANOTHER board must not leak in through the wider filter.
	if strings.Contains(out, "Fix the fence") {
		t.Errorf("board view showed another board's card:\n%s", out)
	}
}

// Grouping a cross-column read by list must not disturb the within-column rank
// order — that order is what `position,id` exists to pin.
func TestBoardViewKeepsWithinColumnOrder(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	out, _, err := runCmd(t, c, "cards", "board", "view", "prjA")
	if err != nil {
		t.Fatal(err)
	}
	// "Write copy" is a0 and "Book venue" a1 in To do, so copy comes first.
	copyAt, venueAt := strings.Index(out, "Write copy"), strings.Index(out, "Book venue")
	if copyAt < 0 || venueAt < 0 {
		t.Fatalf("both To do cards should render:\n%s", out)
	}
	if copyAt > venueAt {
		t.Errorf("rank order within a column was lost by the grouped read:\n%s", out)
	}
}

// A truncated body must stay valid UTF-8. Slicing at a byte offset cuts a
// multi-byte rune in half, so a description of accented text rendered as a
// broken rune — and the visible limit silently depended on the alphabet.
func TestLongMultibyteBodyTruncatesOnRunes(t *testing.T) {
	f := board(t)
	long := strings.Repeat("é", 200)
	f.cards["crdCopy"].Description = long
	_, c := f.serve()
	out, _, err := runCmd(t, c, "cards", "card", "view", "crdCopy")
	if err != nil {
		t.Fatal(err)
	}
	if !utf8.ValidString(out) {
		t.Error("card view emitted invalid UTF-8 — a rune was cut in half")
	}
	if strings.ContainsRune(out, utf8.RuneError) {
		t.Error("card view emitted U+FFFD — a rune was cut in half")
	}
}

// firstLine's cap counts runes, so the visible width does not depend on the
// alphabet: 80 accented characters must survive where 80 ASCII ones would.
func TestFirstLineCapCountsRunesNotBytes(t *testing.T) {
	ascii := firstLine(strings.Repeat("a", 80))
	accented := firstLine(strings.Repeat("é", 80))
	if len([]rune(ascii)) != len([]rune(accented)) {
		t.Errorf("rune counts differ by alphabet: ascii=%d accented=%d",
			len([]rune(ascii)), len([]rune(accented)))
	}
	if got := len([]rune(firstLine(strings.Repeat("é", 200)))); got != 80 {
		t.Errorf("truncated to %d runes, want 80", got)
	}
}

// `-o csv` must emit the record. It used to take the CSV branch with nil
// headers and nil rows, which writes a bare newline and silently drops it —
// a scripted consumer got an empty result rather than an error.
func TestCSVOutputEmitsTheRecord(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{"card add", []string{"cards", "card", "add", "Ship it", "--board", "prjA", "--list", "To do"}, "Ship it"},
		{"card edit", []string{"cards", "card", "edit", "crdCopy", "--title", "Rewritten"}, "Rewritten"},
		{"card move", []string{"cards", "card", "move", "crdCopy", "--list", "Doing"}, "crdCopy"},
		{"card archive", []string{"cards", "card", "archive", "crdVenue"}, "crdVenue"},
		{"card view", []string{"cards", "card", "view", "crdDeck"}, "Design deck"},
		{"list add", []string{"cards", "list", "add", "Blocked", "--board", "prjA"}, "Blocked"},
		{"list rename", []string{"cards", "list", "rename", "Done", "Shipped", "--board", "prjA"}, "Shipped"},
		{"list done", []string{"cards", "list", "done", "Doing", "--board", "prjA"}, "Doing"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			out, _, err := runCmd(t, c, append(tc.args, "--output", "csv")...)
			if err != nil {
				t.Fatal(err)
			}
			if strings.TrimSpace(out) == "" {
				t.Fatal("-o csv produced no output — the record was dropped")
			}
			records, err := csv.NewReader(strings.NewReader(out)).ReadAll()
			if err != nil {
				t.Fatalf("-o csv did not emit parseable CSV: %v\n%s", err, out)
			}
			if len(records) < 2 {
				t.Fatalf("-o csv emitted headers but no row:\n%s", out)
			}
			if !strings.Contains(out, tc.want) {
				t.Errorf("-o csv did not carry %q:\n%s", tc.want, out)
			}
		})
	}
}

// A negative index is a typo or a caller's arithmetic slip, never a request to
// prepend. Clamping it silently carries out a move nobody asked for.
func TestNegativeIndexIsRefused(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	for _, tc := range []struct {
		name string
		args []string
	}{
		{"card add", []string{"cards", "card", "add", "X", "--board", "prjA", "--list", "To do", "--index", "-1"}},
		{"card move", []string{"cards", "card", "move", "crdCopy", "--index", "-1"}},
		{"list add", []string{"cards", "list", "add", "X", "--board", "prjA", "--index", "-1"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := runCmd(t, c, tc.args...)
			if err == nil {
				t.Fatal("a negative index was accepted and silently clamped")
			}
			if !strings.Contains(err.Error(), "negative") {
				t.Errorf("error should name the negative index, got %q", err)
			}
		})
	}
}

// `list move` takes its index POSITIONALLY, so cobra's flag parser rejects a
// leading-dash value before RunE ever sees it. The message is its own, but the
// guarantee that matters is the same one: the column must not move.
func TestListMoveRejectsANegativeIndex(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	before := f.lists["lstDoing"].Position
	if _, _, err := runCmd(t, c, "cards", "list", "move", "Doing", "-1", "--board", "prjA"); err == nil {
		t.Fatal("a negative index was accepted")
	}
	if f.lists["lstDoing"].Position != before {
		t.Error("the column moved despite the negative index being refused")
	}
}

// checkIndex is the guard behind all four paths, including any caller that
// reaches the rank helpers without going through cobra's parser.
func TestRankHelpersRefuseANegativeIndex(t *testing.T) {
	positions := []string{"a0", "a1", "a2"}
	if _, err := rankAt(positions, -1, true); err == nil {
		t.Error("rankAt clamped a negative index instead of refusing it")
	}
	if _, err := rankForReorder(positions, -3); err == nil {
		t.Error("rankForReorder clamped a negative index instead of refusing it")
	}
	// An index past the end still CLAMPS — "one too far" means "last", and
	// that is a different intent from a negative.
	if _, err := rankAt(positions, 99, true); err != nil {
		t.Errorf("an out-of-range-high index should clamp, got %v", err)
	}
}

// An id lookup chunks its `id = ... || id = ...` filter rather than building
// one unbounded query string. The filter rides in the GET query string, so an
// unchunked lookup over a few hundred assignees fails as an opaque 414.
func TestIDLookupChunksItsFilter(t *testing.T) {
	f := board(t)
	var ids []string
	for i := range idLookupChunk*2 + 5 {
		id := fmt.Sprintf("usr%03d", i)
		f.users[id] = &user{ID: id, Email: id + "@example.com"}
		ids = append(ids, id)
	}
	_, c := f.serve()

	before := f.userListCount
	users, err := usersByID(t.Context(), c, ids)
	if err != nil {
		t.Fatal(err)
	}
	if len(users) != len(ids) {
		t.Errorf("resolved %d of %d users — chunking dropped rows", len(users), len(ids))
	}
	if got := f.userListCount - before; got != 3 {
		t.Errorf("%d requests for %d ids at a chunk of %d, want 3", got, len(ids), idLookupChunk)
	}
	if f.longestUserFilter > idLookupChunk*40 {
		t.Errorf("filter grew to %d bytes — it is not chunked", f.longestUserFilter)
	}
}

// Duplicate and empty ids must not each cost a term.
func TestIDLookupDedupesBeforeChunking(t *testing.T) {
	f := board(t)
	_, c := f.serve()
	before := f.userListCount
	users, err := usersByID(t.Context(), c, []string{"user1", "user1", "", "user1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(users) != 1 {
		t.Errorf("want 1 resolved user, got %d", len(users))
	}
	if got := f.userListCount - before; got != 1 {
		t.Errorf("a deduped lookup took %d requests, want 1", got)
	}
}
