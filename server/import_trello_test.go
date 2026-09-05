package boards

import (
	"os"
	"strings"
	"testing"
)

// The Trello parser, against a fixture that carries the awkward cases a real
// export does: duplicate label names, a label with no name, a colour Trello
// ships that this does not map, lists and cards out of `pos` order, an archived
// card, a card naming a list that is not in the file, two checklists on one
// card, and actions that are not comments.
//
// Pure — no app, no database. The parser takes bytes and returns a board.

func trelloFixture(t *testing.T) exportedBoard {
	t.Helper()
	board, _, _ := trelloFixtureWithReport(t)
	return board
}

func trelloFixtureWithReport(t *testing.T) (exportedBoard, importReport, error) {
	t.Helper()
	raw, err := os.ReadFile("testdata/trello_board.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	board, report, err := parseTrelloBoard(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return board, report, err
}

func TestParseTrello_OrdersListsByPos(t *testing.T) {
	board := trelloFixture(t)

	var names []string
	for _, l := range board.Lists {
		names = append(names, l.Name)
	}
	want := []string{"To Do", "In Progress", "Done", "Icebox"}
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Errorf("lists = %v, want %v — the file lists them out of pos order", names, want)
	}

	// Ranks are regenerated, not translated: Trello's pos is a float and this
	// key space is fracdex strings.
	for i, l := range board.Lists {
		if l.Position == "" {
			t.Errorf("list %d has no rank", i)
		}
		if i > 0 && l.Position <= board.Lists[i-1].Position {
			t.Errorf("list %d rank %q does not sort after %q", i, l.Position, board.Lists[i-1].Position)
		}
	}
}

// Trello has no status categories, so they are guessed from the list's name —
// and the guess is reported, so a wrong one is visible rather than silent.
func TestParseTrello_GuessesListCategories(t *testing.T) {
	board, report, _ := trelloFixtureWithReport(t)

	want := map[string]string{
		"To Do":       "todo",
		"In Progress": "in_progress",
		"Done":        "done",
		"Icebox":      "backlog",
	}
	for _, l := range board.Lists {
		if got := l.Category; got != want[l.Name] {
			t.Errorf("list %q category = %q, want %q", l.Name, got, want[l.Name])
		}
	}
	// `todo` is the default, so it is not a guess worth reporting.
	if _, reported := report.GuessedCategories["To Do"]; reported {
		t.Error("the default category was reported as a guess")
	}
	if report.GuessedCategories["Done"] != "done" {
		t.Errorf("guessed categories = %v, want Done reported", report.GuessedCategories)
	}
}

func TestCategoryForListName(t *testing.T) {
	for _, tc := range []struct{ name, want string }{
		{"Done", "done"},
		{"done", "done"},
		{"  Shipped  ", "done"},
		{"In Progress", "in_progress"},
		{"QA", "in_progress"},
		{"Backlog", "backlog"},
		{"To Do", "todo"},
		{"Anything else", "todo"},
		// Matched on the WHOLE name, not as a substring. Both of these are
		// ordinary working columns and neither is finished work.
		{"Definition of Done", "todo"},
		{"Done thinking, now build", "todo"},
	} {
		if got := categoryForListName(tc.name); got != tc.want {
			t.Errorf("categoryForListName(%q) = %q, want %q", tc.name, got, tc.want)
		}
	}
}

// boards_labels is UNIQUE on (project, name), and Trello permits two labels
// with the same name. They fold, and every card that named either keeps
// pointing at the survivor.
func TestParseTrello_FoldsDuplicateLabelNames(t *testing.T) {
	board := trelloFixture(t)

	names := map[string]int{}
	for _, l := range board.Labels {
		names[strings.ToLower(l.Name)]++
	}
	if names["bug"] != 1 {
		t.Errorf("the two 'bug' labels did not fold: %+v", board.Labels)
	}
	// A card holding BOTH folded ids names the survivor once, not twice — a
	// multi-relation with a repeated id is not what the column means.
	card := cardTitled(t, board, "Write the copy")
	if len(card.Labels) != 1 {
		t.Errorf("card labels = %v, want the folded label once", card.Labels)
	}
}

func TestParseTrello_NamesAndColorsLabelsItCannotRead(t *testing.T) {
	board := trelloFixture(t)

	var plain, weird *exportedLabel
	for i := range board.Labels {
		switch board.Labels[i].ID {
		case "lbl_plain":
			plain = &board.Labels[i]
		case "lbl_weird":
			weird = &board.Labels[i]
		}
	}
	// A Trello label may be a bare colour with no name. A blank name fails the
	// column's min length, so the colour becomes the name.
	if plain == nil || plain.Name != "purple" {
		t.Errorf("an unnamed label did not fall back to its colour: %+v", plain)
	}
	// An unmapped colour falls back rather than failing the import.
	if weird == nil || weird.Color != trelloFallbackColor {
		t.Errorf("an unknown colour did not fall back: %+v", weird)
	}
}

func TestParseTrello_OrdersCardsWithinTheirList(t *testing.T) {
	board := trelloFixture(t)

	var todo []string
	listID := listNamed(t, board, "To Do").ID
	for _, c := range board.Cards {
		if c.List == listID {
			todo = append(todo, c.Title)
		}
	}
	want := []string{"Book the venue", "Write the copy"}
	if strings.Join(todo, ",") != strings.Join(want, ",") {
		t.Errorf("To Do = %v, want %v — cards are not in pos order", todo, want)
	}
}

// A card naming a list the file never defined has nowhere to go. It is left out
// rather than dropped silently — the writer reports it.
func TestParseTrello_KeepsACardWhoseListIsMissing(t *testing.T) {
	board := trelloFixture(t)

	for _, c := range board.Cards {
		if c.Title == "Card with no list" {
			t.Fatal("a card with an unknown list was placed on a real list")
		}
	}
}

func TestParseTrello_CarriesArchivedCards(t *testing.T) {
	board, report, _ := trelloFixtureWithReport(t)

	card := cardTitled(t, board, "Old idea")
	if !card.Archived {
		t.Error("an archived Trello card imported as active")
	}
	if report.ArchivedCards != 1 {
		t.Errorf("archived count = %d, want 1", report.ArchivedCards)
	}
}

// Boards has ONE checklist per card and Trello has many, so they concatenate in
// board order — and the items inside each keep their own order.
func TestParseTrello_ConcatenatesChecklistsInOrder(t *testing.T) {
	board := trelloFixture(t)

	card := cardTitled(t, board, "Write the copy")
	var titles []string
	for _, item := range card.Checklist {
		titles = append(titles, item.Title)
	}
	want := []string{"Pick the hero image", "Draft the headline", "Proofread"}
	if strings.Join(titles, ",") != strings.Join(want, ",") {
		t.Errorf("checklist = %v, want %v", titles, want)
	}
	if !card.Checklist[1].IsDone {
		t.Error("a complete check item imported as open")
	}
}

// Comments live in the action log. Only commentCard actions are comments, and
// they arrive oldest-first regardless of the order the log holds them in.
func TestParseTrello_ReadsCommentsFromTheActionLog(t *testing.T) {
	board := trelloFixture(t)

	card := cardTitled(t, board, "Write the copy")
	if len(card.Comments) != 2 {
		t.Fatalf("comments = %d, want 2 (the third action is not a comment)", len(card.Comments))
	}
	if !strings.Contains(card.Comments[0].Body, "First comment") {
		t.Errorf("comments are not oldest-first: %+v", card.Comments)
	}
	// The original author is recorded in the BODY: their Trello id resolves to
	// nobody here, and the author column must point at a real user, so the
	// writer attributes the row to the importer instead.
	if !strings.Contains(card.Comments[0].Body, "alan") {
		t.Errorf("the original author was lost: %q", card.Comments[0].Body)
	}
	if !strings.Contains(card.Comments[1].Body, "Ada Lovelace") {
		t.Errorf("a full name was not preferred over the username: %q", card.Comments[1].Body)
	}
}

func TestParseTrello_ReportsTheAssigneesItDropped(t *testing.T) {
	_, report, _ := trelloFixtureWithReport(t)

	joined := strings.Join(report.DroppedAssignees, ",")
	if !strings.Contains(joined, "Ada Lovelace") || !strings.Contains(joined, "alan") {
		t.Errorf("dropped assignees = %v, want both members named", report.DroppedAssignees)
	}
	// Named once each, however many cards they were on.
	if len(report.DroppedAssignees) != 2 {
		t.Errorf("dropped assignees = %v, want each person once", report.DroppedAssignees)
	}
}

func TestParseTrello_KeepsDueAndStart(t *testing.T) {
	board := trelloFixture(t)

	card := cardTitled(t, board, "Write the copy")
	// A Trello due carries a time of day, so the instant survives — the
	// self-describing convention the writer reads back to set due_has_time.
	if !strings.HasPrefix(card.Due, "2026-10-01T17:00") {
		t.Errorf("due = %q, want the instant kept", card.Due)
	}
	// A start is a day, so it keeps its day half.
	if card.Start != "2026-09-20" {
		t.Errorf("start = %q, want the day", card.Start)
	}
}

func TestParseTrello_RefusesWhatIsNotABoard(t *testing.T) {
	if _, _, err := parseTrelloBoard([]byte(`{"hello":"world"}`)); err == nil {
		t.Error("a JSON document with no board in it was accepted")
	}
	if _, _, err := parseTrelloBoard([]byte(`not json at all`)); err == nil {
		t.Error("a non-JSON file was accepted")
	}
}

// A title longer than the column allows is truncated rather than refused:
// losing a whole import over one card is the worse outcome, and the full text
// is still in the description.
func TestParseTrello_TruncatesAnOverlongTitle(t *testing.T) {
	long := strings.Repeat("x", 900)
	raw := []byte(`{"name":"B","lists":[{"id":"l","name":"To Do","pos":1}],` +
		`"cards":[{"id":"c","name":"` + long + `","idList":"l","pos":1}]}`)
	board, _, err := parseTrelloBoard(raw)
	if err != nil {
		t.Fatal(err)
	}
	if runes := []rune(board.Cards[0].Title); len(runes) > 500 {
		t.Errorf("title is %d runes, want no more than the column's 500", len(runes))
	}
}

func cardTitled(t *testing.T, board exportedBoard, title string) exportedCard {
	t.Helper()
	for _, c := range board.Cards {
		if c.Title == title {
			return c
		}
	}
	t.Fatalf("no card titled %q", title)
	return exportedCard{}
}

func listNamed(t *testing.T, board exportedBoard, name string) exportedList {
	t.Helper()
	for _, l := range board.Lists {
		if l.Name == name {
			return l
		}
	}
	t.Fatalf("no list named %q", name)
	return exportedList{}
}
