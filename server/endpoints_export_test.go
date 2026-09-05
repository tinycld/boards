package boards

import (
	"encoding/csv"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// The export endpoint, mounted through the SAME route table production binds,
// so a test cannot keep passing after that table changes.

func mountExportRoutes(e *core.ServeEvent) { bindExportRoutes(e) }

// seedExportBoard fills env.project with enough shape that both formats have
// something to say: two columns of differing category, a label on a card, a
// second card that is archived, and a checklist item.
//
// Card numbers are set BY HAND. In production card_number.go assigns them on
// create, but these suites bind no hooks by design (see rls_setup_test.go), so
// a fixture card lands unnumbered — and an export test that asserts on keys
// has to supply what the missing hook would have.
func seedExportBoard(t *testing.T, env *cardsEnv) {
	t.Helper()

	env.project.Set("slug", "OTTER")
	if err := env.app.Save(env.project); err != nil {
		t.Fatalf("set slug: %v", err)
	}

	env.list.Set("category", "in_progress")
	if err := env.app.Save(env.list); err != nil {
		t.Fatalf("set category: %v", err)
	}
	env.list2.Set("category", "done")
	if err := env.app.Save(env.list2); err != nil {
		t.Fatalf("set category: %v", err)
	}

	bug := cardsLabel(t, env.app, env.project, "bug", "#ff0000")

	env.card.Set("number", 1)
	env.card.Set("labels", []string{bug.Id})
	env.card.Set("assignees", []string{env.editor.Id})
	env.card.Set("priority", "high")
	env.card.Set("estimate", 5)
	env.card.Set("due", "2026-09-30 00:00:00.000Z")
	if err := env.app.Save(env.card); err != nil {
		t.Fatalf("enrich card: %v", err)
	}

	done := cardsCard(t, env.app, env.project, env.list2, "Shipped", "a1", env.owner)
	done.Set("number", 2)
	done.Set("archived", true)
	if err := env.app.Save(done); err != nil {
		t.Fatalf("archive card: %v", err)
	}

	cardsChecklistItem(t, env.app, env.project, env.card, "Write it down", "a0")
}

func TestExportEndpoint_CSVCarriesTheBoard(t *testing.T) {
	env := setupCardsEnv(t)
	seedExportBoard(t, env)

	req{
		method: http.MethodGet,
		url:    "/api/boards/export?project=" + env.project.Id,
		token:  env.ownerToken,
		want:   http.StatusOK,
		content: []string{
			"key,title,description,list",
			"OTTER-1",
			// The label and the assignee resolve to NAMES, not ids — a file
			// full of record ids is not something a person or a spreadsheet
			// can group by.
			"bug",
			"high",
			// The archived card is present and flagged, because the export
			// doubles as a backup.
			"OTTER-2",
			"true",
		},
		before: mountExportRoutes,
	}.run(t, env)
}

// The CSV must survive a real parser, not just a substring match: a title
// carrying a comma, a quote or a newline is ordinary user text, and a hand-rolled
// join would corrupt the file at exactly that point.
func TestExportEndpoint_CSVQuotesHostileText(t *testing.T) {
	env := setupCardsEnv(t)
	seedExportBoard(t, env)

	env.card.Set("title", `Fix "the", thing`+"\nurgently")
	if err := env.app.Save(env.card); err != nil {
		t.Fatalf("set title: %v", err)
	}

	body := exportBody(t, env, "csv")
	rows, err := csv.NewReader(strings.NewReader(body)).ReadAll()
	if err != nil {
		t.Fatalf("the export is not parseable CSV: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("want a header and two cards, got %d rows", len(rows))
	}
	if rows[0][0] != "key" || rows[0][1] != "title" {
		t.Fatalf("unexpected header: %v", rows[0])
	}
	if got := rows[1][1]; got != `Fix "the", thing`+"\nurgently" {
		t.Errorf("title did not survive the round trip through CSV: %q", got)
	}
}

func TestExportEndpoint_JSONCarriesChildren(t *testing.T) {
	env := setupCardsEnv(t)
	seedExportBoard(t, env)

	var board exportedBoard
	if err := json.Unmarshal([]byte(exportBody(t, env, "json")), &board); err != nil {
		t.Fatalf("decode export: %v", err)
	}

	if board.Slug != "OTTER" {
		t.Errorf("slug: want OTTER, got %q", board.Slug)
	}
	if len(board.Lists) != 2 {
		t.Fatalf("want 2 lists, got %d", len(board.Lists))
	}
	if len(board.Cards) != 2 {
		t.Fatalf("want 2 cards, got %d", len(board.Cards))
	}
	// The children a CSV row cannot hold are the whole reason the JSON format
	// exists, so their absence is the failure worth naming.
	first := board.Cards[0]
	if len(first.Checklist) != 1 || first.Checklist[0].Title != "Write it down" {
		t.Errorf("checklist did not travel: %+v", first.Checklist)
	}
	if len(board.Labels) != 1 {
		t.Errorf("want the board's label, got %+v", board.Labels)
	}
}

// A list written before the category column existed, or by a client that
// omitted it, stores ”. It means an ordinary working list, and the export must
// say so rather than emitting a blank a re-import would have to guess at.
func TestExportEndpoint_BlankCategoryReadsAsTodo(t *testing.T) {
	env := setupCardsEnv(t)
	seedExportBoard(t, env)

	env.list.Set("category", "")
	if err := env.app.Save(env.list); err != nil {
		t.Fatalf("blank the category: %v", err)
	}

	var board exportedBoard
	if err := json.Unmarshal([]byte(exportBody(t, env, "json")), &board); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	for _, l := range board.Lists {
		if l.ID == env.list.Id && l.Category != "todo" {
			t.Errorf("a blank category must export as todo, got %q", l.Category)
		}
	}
}

// Any member may export. A viewer already reads every card through the ordinary
// REST, so refusing them a file would protect nothing.
func TestExportEndpoint_ViewerMayExport(t *testing.T) {
	env := setupCardsEnv(t)
	seedExportBoard(t, env)

	req{
		method:  http.MethodGet,
		url:     "/api/boards/export?project=" + env.project.Id,
		token:   env.viewerToken,
		want:    http.StatusOK,
		content: []string{"OTTER-1"},
		before:  mountExportRoutes,
	}.run(t, env)
}

// A non-member gets 404, never 403: a 403 would confirm the board id is real,
// which is the existence oracle the other boards endpoints are careful to deny.
func TestExportEndpoint_OutsiderNotFound(t *testing.T) {
	env := setupCardsEnv(t)
	seedExportBoard(t, env)

	req{
		method: http.MethodGet,
		url:    "/api/boards/export?project=" + env.project.Id,
		token:  env.outsiderToken,
		want:   http.StatusNotFound,
		before: mountExportRoutes,
	}.run(t, env)
}

func TestExportEndpoint_AnonymousUnauthorized(t *testing.T) {
	env := setupCardsEnv(t)
	seedExportBoard(t, env)

	req{
		method: http.MethodGet,
		url:    "/api/boards/export?project=" + env.project.Id,
		want:   http.StatusUnauthorized,
		before: mountExportRoutes,
	}.run(t, env)
}

// The reason requireEnabledAuth exists rather than the package's own
// requireAuth. A raw route runs no collection rules, so the
// `@request.auth.disabled != true` clause every boards rule carries does not
// apply here — and a token minted before the account was disabled keeps working
// until it expires.
func TestExportEndpoint_DisabledAccountForbidden(t *testing.T) {
	env := setupCardsEnv(t)
	seedExportBoard(t, env)

	env.owner.Set("disabled", true)
	if err := env.app.Save(env.owner); err != nil {
		t.Fatalf("disable the owner: %v", err)
	}

	req{
		method: http.MethodGet,
		url:    "/api/boards/export?project=" + env.project.Id,
		token:  env.ownerToken,
		want:   http.StatusForbidden,
		before: mountExportRoutes,
	}.run(t, env)
}

func TestExportEndpoint_RejectsAMissingBoard(t *testing.T) {
	env := setupCardsEnv(t)
	seedExportBoard(t, env)

	req{
		method: http.MethodGet,
		url:    "/api/boards/export",
		token:  env.ownerToken,
		want:   http.StatusBadRequest,
		before: mountExportRoutes,
	}.run(t, env)
}

// A separate Test function rather than a second scenario above: ApiScenario.Test
// re-triggers OnServe, and two scenarios against one app panic on duplicate
// route registration (see rls_setup_test.go).
func TestExportEndpoint_RejectsAnUnknownFormat(t *testing.T) {
	env := setupCardsEnv(t)
	seedExportBoard(t, env)

	req{
		method: http.MethodGet,
		url:    "/api/boards/export?project=" + env.project.Id + "&format=xlsx",
		token:  env.ownerToken,
		want:   http.StatusBadRequest,
		before: mountExportRoutes,
	}.run(t, env)
}

// Two exports of an unchanged board must be byte-identical. Ranks are not
// unique, so without the `position, id` tiebreaker the row order would depend
// on whatever order SQLite handed back — and the round-trip test in the
// importer's suite could not assert equality at all.
func TestExportIsStableAcrossRuns(t *testing.T) {
	env := setupCardsEnv(t)
	seedExportBoard(t, env)

	// Collected directly rather than through two HTTP round trips:
	// ApiScenario.Test re-triggers OnServe, so two scenarios against one app
	// panic on duplicate route registration. The ordering under test is
	// collectBoard's, which is what both formats render from.
	first, err := collectBoard(env.app, env.project)
	if err != nil {
		t.Fatal(err)
	}
	second, err := collectBoard(env.app, env.project)
	if err != nil {
		t.Fatal(err)
	}
	a, err := json.Marshal(first)
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(second)
	if err != nil {
		t.Fatal(err)
	}
	if string(a) != string(b) {
		t.Error("two exports of an unchanged board differ")
	}
}

// Cards come out grouped by their column, in column order, and ranked within
// it. `position` only orders cards INSIDE one list, so a global rank sort
// interleaves the columns — an order no reader would recognise, and one that a
// re-import (which groups by list again) does not reproduce.
func TestExportOrdersCardsByListThenRank(t *testing.T) {
	env := setupCardsEnv(t)
	seedExportBoard(t, env)

	// A second card in the FIRST column, ranked after the seeded one but with a
	// rank that sorts after the second column's card too — so a global sort
	// would put it last rather than beside its neighbour.
	late := cardsCard(t, env.app, env.project, env.list, "Also to do", "a9", env.owner)
	late.Set("number", 3)
	if err := env.app.Save(late); err != nil {
		t.Fatal(err)
	}

	board, err := collectBoard(env.app, env.project)
	if err != nil {
		t.Fatal(err)
	}

	// Every card of the first list must appear before any card of the second.
	firstList := board.Lists[0].ID
	seenOther := false
	for _, c := range board.Cards {
		if c.List != firstList {
			seenOther = true
			continue
		}
		if seenOther {
			t.Fatalf("card %q of the first column appears after another column's", c.Title)
		}
	}
}

func TestExportFilename(t *testing.T) {
	env := setupCardsEnv(t)
	col, err := env.app.FindCollectionByNameOrId("boards_projects")
	if err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name, slug, board, format, want string
	}{
		{"slug wins", "OTTER", "Otter Board", "csv", "otter.csv"},
		{"falls back to the name", "", "Otter Board", "json", "otter-board.json"},
		{"strips a path", "", "../../etc/passwd", "csv", "etc-passwd.csv"},
		{"survives a name with nothing safe in it", "", "///", "csv", "board.csv"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := core.NewRecord(col)
			p.Set("slug", tc.slug)
			p.Set("name", tc.board)
			if got := exportFilename(p, tc.format); got != tc.want {
				t.Errorf("want %q, got %q", tc.want, got)
			}
		})
	}
}

// exportBody runs an export and hands back the response body.
//
// The `content` assertions elsewhere in this file are substring matches; these
// tests need the bytes themselves — to parse as CSV, to unmarshal as JSON, or
// to compare two runs — which is what the harness's `into` is for. It still
// mounts the same bindExportRoutes production does.
func exportBody(t *testing.T, env *cardsEnv, format string) string {
	t.Helper()
	var body string
	req{
		method: http.MethodGet,
		url:    "/api/boards/export?project=" + env.project.Id + "&format=" + format,
		token:  env.ownerToken,
		want:   http.StatusOK,
		// ApiScenario asserts an EMPTY body when ExpectedContent is empty, so a
		// body-capturing run still has to name something it expects. A card key
		// is in both formats; the board's name is only in the JSON.
		content: []string{"OTTER-1"},
		before:  mountExportRoutes,
		into:    &body,
	}.run(t, env)
	return body
}
