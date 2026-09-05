package cli

import (
	"strings"
	"testing"
)

// The sprint commands against the fake server: naming by number, `active`
// and `next`; the create that lets the server number; the transitions'
// bodies; and the refusals that keep the CLI from guessing.

func sprintBoard(t *testing.T) *fakeCards {
	f := board(t)
	f.addSprint("sprDone", "prjA", 1, "", "completed", "a0")
	f.addSprint("sprNow", "prjA", 2, "Polish", "active", "a1")
	f.addSprint("sprNext", "prjA", 3, "", "planned", "a2")
	f.addSprint("sprLater", "prjA", 4, "", "planned", "a3")
	f.cards["crdCopy"].Sprint = "sprNow"
	f.cards["crdVenue"].Sprint = "sprNext"
	return f
}

func TestSprintListShowsTheBoardsSprintsInNumberOrder(t *testing.T) {
	f := sprintBoard(t)
	_, c := f.serve()
	out, _, err := runCmd(t, c, "boards", "sprint", "list", "Product launch")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Polish", "active", "planned", "completed", "sprNext"} {
		if !strings.Contains(out, want) {
			t.Errorf("sprint list missing %q:\n%s", want, out)
		}
	}
	if strings.Index(out, "sprDone") > strings.Index(out, "sprLater") {
		t.Errorf("sprints are not in number order:\n%s", out)
	}
}

func TestSprintViewResolvesActiveAndNextAndANumber(t *testing.T) {
	f := sprintBoard(t)
	_, c := f.serve()
	cases := map[string]string{"active": "Polish", "next": "Sprint 3", "4": "Sprint 4", "sprDone": "Sprint 1"}
	for ref, want := range cases {
		out, _, err := runCmd(t, c, "boards", "sprint", "view", ref, "--board", "Product launch")
		if err != nil {
			t.Fatalf("view %s: %v", ref, err)
		}
		if !strings.Contains(out, want) {
			t.Errorf("view %s: missing %q:\n%s", ref, want, out)
		}
	}
	// The active sprint's card is listed under it.
	out, _, _ := runCmd(t, c, "boards", "sprint", "view", "active", "--board", "Product launch")
	if !strings.Contains(out, "Write copy") {
		t.Errorf("the active sprint's card is missing:\n%s", out)
	}
}

func TestSprintViewByIdNeedsNoBoard(t *testing.T) {
	f := sprintBoard(t)
	_, c := f.serve()
	out, _, err := runCmd(t, c, "boards", "sprint", "view", "sprNow")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "Polish") {
		t.Errorf("view by id missing the sprint:\n%s", out)
	}
	if _, _, err := runCmd(t, c, "boards", "sprint", "view", "2"); err == nil {
		t.Error("a bare number resolved without --board")
	}
}

func TestSprintNamesAreNeverResolved(t *testing.T) {
	f := sprintBoard(t)
	_, c := f.serve()
	if _, _, err := runCmd(t, c, "boards", "sprint", "view", "Polish", "--board", "Product launch"); err == nil {
		t.Error("a sprint resolved by name")
	}
}

func TestSprintCreateLetsTheServerNumberAndAppendsAfterThePlanned(t *testing.T) {
	f := sprintBoard(t)
	_, c := f.serve()
	_, _, err := runCmd(t, c, "boards", "sprint", "create", "--board", "Product launch",
		"--name", "Hardening", "--start", "2026-10-01", "--end", "2026-10-14")
	if err != nil {
		t.Fatal(err)
	}
	if _, sent := f.lastSprintCreate["number"]; sent {
		t.Error("create sent `number`, which the server assigns")
	}
	if got := str(f.lastSprintCreate["state"]); got != "planned" {
		t.Errorf("state = %q, want planned", got)
	}
	// After a3, the last planned rank.
	if got := str(f.lastSprintCreate["position"]); got <= "a3" {
		t.Errorf("position = %q, want after a3", got)
	}
	if got := str(f.lastSprintCreate["start"]); got != "2026-10-01 00:00:00.000Z" {
		t.Errorf("start = %q", got)
	}
}

func TestSprintCreateRefusesAnEndBeforeTheStart(t *testing.T) {
	f := sprintBoard(t)
	_, c := f.serve()
	_, _, err := runCmd(t, c, "boards", "sprint", "create", "--board", "Product launch",
		"--start", "2026-10-14", "--end", "2026-10-01")
	if err == nil || f.lastSprintCreate != nil {
		t.Fatalf("an end before the start was accepted: %v", err)
	}
}

func TestSprintEditOnlySendsChangedFields(t *testing.T) {
	f := sprintBoard(t)
	_, c := f.serve()
	_, _, err := runCmd(t, c, "boards", "sprint", "edit", "next", "--board", "Product launch", "--goal", "Ship it")
	if err != nil {
		t.Fatal(err)
	}
	if _, sent := f.lastSprintPatch["name"]; sent {
		t.Error("edit sent `name` when only --goal was passed")
	}
	if f.sprints["sprNext"].Goal != "Ship it" {
		t.Errorf("goal = %q", f.sprints["sprNext"].Goal)
	}
	if _, _, err := runCmd(t, c, "boards", "sprint", "edit", "next", "--board", "Product launch",
		"--start", "2026-10-01", "--clear-start"); err == nil {
		t.Error("--start and --clear-start together were accepted")
	}
}

func TestSprintStartCallsTheEndpointWithTheDates(t *testing.T) {
	f := sprintBoard(t)
	f.sprints["sprNow"].State = "completed"
	_, c := f.serve()
	_, stderr, err := runCmd(t, c, "boards", "sprint", "start", "3", "--board", "Product launch",
		"--start", "2026-09-07", "--end", "2026-09-20")
	if err != nil {
		t.Fatal(err)
	}
	if f.startedSprint != "sprNext" {
		t.Fatalf("started %q, want sprNext", f.startedSprint)
	}
	if got := str(f.lastSprintStart["start"]); got != "2026-09-07 00:00:00.000Z" {
		t.Errorf("start = %q", got)
	}
	if !strings.Contains(stderr, "committed to 1 card") {
		t.Errorf("start did not narrate the commitment:\n%s", stderr)
	}
}

func TestSprintCompleteRefusesToGuessWhereUnfinishedCardsGo(t *testing.T) {
	f := sprintBoard(t)
	_, c := f.serve()
	_, _, err := runCmd(t, c, "boards", "sprint", "complete", "active", "--board", "Product launch", "--unfinished", "sideways")
	if err == nil || f.completedSprint != "" {
		t.Fatalf("an unknown --unfinished was accepted: %v", err)
	}
	// No --unfinished is sent as-is: the SERVER decides whether an answer was
	// needed (a sprint with nothing unfinished needs none).
	_, _, err = runCmd(t, c, "boards", "sprint", "complete", "active", "--board", "Product launch")
	if err != nil {
		t.Fatal(err)
	}
	if got := str(f.lastSprintComplete["unfinished"]); got != "" {
		t.Errorf("unfinished = %q, want empty", got)
	}
}

func TestSprintCompleteNextSendsThePlannedTarget(t *testing.T) {
	f := sprintBoard(t)
	_, c := f.serve()
	_, stderr, err := runCmd(t, c, "boards", "sprint", "complete", "active", "--board", "Product launch", "--unfinished", "next")
	if err != nil {
		t.Fatal(err)
	}
	if got := str(f.lastSprintComplete["next_sprint"]); got != "sprNext" {
		t.Errorf("next_sprint = %q, want sprNext (the lowest-ranked planned sprint)", got)
	}
	if f.cards["crdCopy"].Sprint != "sprNext" {
		t.Errorf("the unfinished card did not roll: sprint = %q", f.cards["crdCopy"].Sprint)
	}
	if !strings.Contains(stderr, "moved 1 unfinished card to Sprint 3") {
		t.Errorf("completion did not narrate the rollover:\n%s", stderr)
	}
}

func TestSprintCompleteNextPicksTheNamedSprint(t *testing.T) {
	f := sprintBoard(t)
	_, c := f.serve()
	_, _, err := runCmd(t, c, "boards", "sprint", "complete", "active", "--board", "Product launch",
		"--unfinished", "next", "--next", "4")
	if err != nil {
		t.Fatal(err)
	}
	if got := str(f.lastSprintComplete["next_sprint"]); got != "sprLater" {
		t.Errorf("next_sprint = %q, want sprLater", got)
	}
	if _, _, err := runCmd(t, c, "boards", "sprint", "complete", "active", "--board", "Product launch",
		"--unfinished", "backlog", "--next", "4"); err == nil {
		t.Error("--next without --unfinished next was accepted")
	}
}

func TestSprintDeleteConfirms(t *testing.T) {
	f := sprintBoard(t)
	_, c := f.serve()
	_, _, err := runCmd(t, c, "boards", "sprint", "delete", "4", "--board", "Product launch", "--yes")
	if err != nil {
		t.Fatal(err)
	}
	if len(f.deletedSprints) != 1 || f.deletedSprints[0] != "sprLater" {
		t.Errorf("deleted = %v, want [sprLater]", f.deletedSprints)
	}
}

func TestCardAddFilesIntoASprint(t *testing.T) {
	f := sprintBoard(t)
	_, c := f.serve()
	_, _, err := runCmd(t, c, "boards", "card", "add", "Rehearse", "--board", "Product launch",
		"--list", "To do", "--sprint", "active")
	if err != nil {
		t.Fatal(err)
	}
	if got := str(f.lastCardCreate["sprint"]); got != "sprNow" {
		t.Errorf("sprint = %q, want sprNow", got)
	}
}

func TestCardEditSprintByNumberAndClear(t *testing.T) {
	f := sprintBoard(t)
	_, c := f.serve()
	// Resolved within the CARD's board, so no --board is needed.
	if _, _, err := runCmd(t, c, "boards", "card", "edit", "crdCopy", "--sprint", "3"); err != nil {
		t.Fatal(err)
	}
	if got := str(f.lastCardPatch["sprint"]); got != "sprNext" {
		t.Errorf("sprint = %q, want sprNext", got)
	}
	if _, _, err := runCmd(t, c, "boards", "card", "edit", "crdCopy", "--clear-sprint"); err != nil {
		t.Fatal(err)
	}
	if got, ok := f.lastCardPatch["sprint"]; !ok || got != "" {
		t.Errorf("clear sent sprint = %v, want \"\"", got)
	}
	if _, _, err := runCmd(t, c, "boards", "card", "edit", "crdCopy", "--sprint", "3", "--clear-sprint"); err == nil {
		t.Error("--sprint and --clear-sprint together were accepted")
	}
}

func TestCardViewShowsTheSprint(t *testing.T) {
	f := sprintBoard(t)
	_, c := f.serve()
	out, _, err := runCmd(t, c, "boards", "card", "view", "crdCopy")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "Sprint") || !strings.Contains(out, "Polish") {
		t.Errorf("card view missing the sprint row:\n%s", out)
	}
}

func TestBoardViewScopesToASprintOrTheBacklog(t *testing.T) {
	f := sprintBoard(t)
	_, c := f.serve()
	out, _, err := runCmd(t, c, "boards", "view", "Product launch", "--sprint", "active")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "Write copy") || strings.Contains(out, "Book venue") {
		t.Errorf("--sprint active did not scope the board:\n%s", out)
	}
	out, _, err = runCmd(t, c, "boards", "view", "Product launch", "--sprint", "backlog")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "Design deck") || strings.Contains(out, "Write copy") {
		t.Errorf("--sprint backlog did not scope to unfiled cards:\n%s", out)
	}
}
