package boards

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// The import endpoint, mounted through the SAME route table production binds.
//
// Unlike the RLS suites these need the hooks live — the point of several of
// them is what the hooks did or did not write — so they run against an env that
// binds them.

func mountImportRoutes(e *core.ServeEvent) { bindImportRoutes(e) }

// setupImportEnv binds the hooks an import depends on for its side effects.
//
// setupCardsEnv binds NONE by design — the RLS suites measure the rule engine
// alone — so a test asserting on what the allocator or the watcher wrote has to
// bind them, exactly as setupActivityEnv does for the history hooks.
func setupImportEnv(t *testing.T) *cardsEnv {
	t.Helper()
	env := setupCardsEnv(t)
	// The number allocator's create branch, bound the way card_number_test.go
	// binds it: registerCardNumbers takes a *pocketbase.PocketBase, which a
	// TestApp is not.
	env.app.OnRecordCreate("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		n, err := allocateNumber(e.App, e.Record.GetString("project"))
		if err != nil {
			return err
		}
		e.Record.Set("number", n)
		return e.Next()
	})
	registerAutoWatch(env.app)
	return env
}

func trelloFixtureBytes(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile("testdata/trello_board.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return raw
}

// importBoard posts a file and returns what the endpoint reported.
func importBoard(t *testing.T, env *cardsEnv, token string, body []byte, query string) importResult {
	t.Helper()
	var raw string
	req{
		method:  http.MethodPost,
		url:     "/api/boards/import" + query,
		token:   token,
		body:    string(body),
		want:    http.StatusOK,
		content: []string{`"project"`},
		before:  mountImportRoutes,
		into:    &raw,
	}.run(t, env)

	var result importResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatalf("decode result: %v", err)
	}
	return result
}

func TestImportEndpoint_CreatesTheBoardFromATrelloExport(t *testing.T) {
	env := setupCardsEnv(t)
	result := importBoard(t, env, env.ownerToken, trelloFixtureBytes(t), "")

	if result.Name != "Product Launch" {
		t.Errorf("name = %q, want the Trello board's", result.Name)
	}
	// Four lists; four of the five cards (the fifth names a list the file does
	// not define, and is reported rather than placed).
	if result.Lists != 4 {
		t.Errorf("lists = %d, want 4", result.Lists)
	}
	if result.Cards != 4 {
		t.Errorf("cards = %d, want 4", result.Cards)
	}
	if result.Failed != 1 || len(result.Errors) != 1 {
		t.Errorf("want the orphan card reported: failed=%d errors=%v", result.Failed, result.Errors)
	}
	if !strings.Contains(result.Errors[0], "list is not in the file") {
		t.Errorf("the reported error does not say what went wrong: %q", result.Errors[0])
	}
	// The two Trello labels named "bug" fold into one.
	if result.Labels != 4 {
		t.Errorf("labels = %d, want 4 after the duplicate folds", result.Labels)
	}
	if result.ChecklistItems != 3 {
		t.Errorf("checklist items = %d, want 3", result.ChecklistItems)
	}
	if result.Comments != 2 {
		t.Errorf("comments = %d, want 2", result.Comments)
	}
	if result.ArchivedCards != 1 {
		t.Errorf("archived = %d, want 1", result.ArchivedCards)
	}
	if len(result.DroppedAssignees) != 2 {
		t.Errorf("dropped assignees = %v, want both Trello members named", result.DroppedAssignees)
	}
}

// The importer owns the board it just made — inserted by the same user while
// the board has no members, which is the bootstrapFirstOwner shape.
func TestImportEndpoint_MakesTheCallerTheOwner(t *testing.T) {
	env := setupCardsEnv(t)
	result := importBoard(t, env, env.editorToken, trelloFixtureBytes(t), "")

	members, err := env.app.FindAllRecords("boards_project_members",
		dbx.HashExp{"project": result.Project})
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 1 {
		t.Fatalf("members = %d, want just the importer", len(members))
	}
	if members[0].GetString("user") != env.editor.Id {
		t.Errorf("member = %q, want the caller", members[0].GetString("user"))
	}
	if role := members[0].GetString("role"); role != "owner" {
		t.Errorf("role = %q, want owner", role)
	}
}

// Cards must be numbered in the order they appear, which is why they are
// inserted one at a time: `number` is allocated by a compare-and-swap on the
// board's counter, so parallel inserts would scramble the keys against the
// board's visible order.
func TestImportEndpoint_NumbersCardsInBoardOrder(t *testing.T) {
	env := setupImportEnv(t)
	result := importBoard(t, env, env.ownerToken, trelloFixtureBytes(t), "")

	cards, err := env.app.FindAllRecords("boards_cards", dbx.HashExp{"project": result.Project})
	if err != nil {
		t.Fatal(err)
	}
	sortByRank(cards)
	for _, c := range cards {
		if c.GetInt("number") <= 0 {
			t.Fatalf("card %q has no number — the allocator did not run", c.GetString("title"))
		}
	}
	// Within a list, rank order and number order must agree.
	byList := map[string][]*core.Record{}
	for _, c := range cards {
		byList[c.GetString("list")] = append(byList[c.GetString("list")], c)
	}
	for _, rows := range byList {
		for i := 1; i < len(rows); i++ {
			if rows[i].GetInt("number") <= rows[i-1].GetInt("number") {
				t.Errorf("card %q (#%d) is ranked after %q (#%d) but numbered before it",
					rows[i].GetString("title"), rows[i].GetInt("number"),
					rows[i-1].GetString("title"), rows[i-1].GetInt("number"))
			}
		}
	}
}

// Every child row carries `project` as well as `card`: the access rules resolve
// membership through the denormalized column, not through card.list.project, so
// a row missing it is invisible to everyone including its author.
func TestImportEndpoint_DenormalizesProjectOntoChildren(t *testing.T) {
	env := setupCardsEnv(t)
	result := importBoard(t, env, env.ownerToken, trelloFixtureBytes(t), "")

	for _, collection := range []string{"boards_checklist_items", "boards_comments"} {
		rows, err := env.app.FindAllRecords(collection, dbx.HashExp{"project": result.Project})
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) == 0 {
			t.Errorf("%s: no rows carry the project", collection)
		}
	}
}

// The whole point of the hooks flag. A 500-card import would otherwise write
// 500 "created" rows, burying the history of the work that follows.
func TestImportEndpoint_WritesNoActivityByDefault(t *testing.T) {
	env := setupActivityEnv(t)
	result := importBoard(t, env, env.ownerToken, trelloFixtureBytes(t), "")

	rows, err := env.app.FindAllRecords("boards_activity", dbx.HashExp{"project": result.Project})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Errorf("a quiet import wrote %d activity rows", len(rows))
	}
}

func TestImportEndpoint_WritesActivityWhenAsked(t *testing.T) {
	env := setupActivityEnv(t)
	result := importBoard(t, env, env.ownerToken, trelloFixtureBytes(t), "?hooks=true")

	rows, err := env.app.FindAllRecords("boards_activity", dbx.HashExp{"project": result.Project})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		t.Error("hooks=true wrote no activity rows")
	}
}

// Auto-watch is deliberately NOT suppressed: the importer owns the board, and
// watching their own cards is what making them by hand would have given them.
func TestImportEndpoint_StillWatchesTheImportedCards(t *testing.T) {
	env := setupImportEnv(t)
	result := importBoard(t, env, env.ownerToken, trelloFixtureBytes(t), "")

	rows, err := env.app.FindAllRecords("boards_card_watchers", dbx.HashExp{"project": result.Project})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		t.Error("an import left the owner watching none of their own cards")
	}
}

func TestImportEndpoint_RenamesTheBoardWhenAsked(t *testing.T) {
	env := setupCardsEnv(t)
	result := importBoard(t, env, env.ownerToken, trelloFixtureBytes(t), "?name=Spring+launch")

	if result.Name != "Spring launch" {
		t.Errorf("name = %q, want the override", result.Name)
	}
}

// A guest reaches the app only through a share link, and boards_projects'
// create rule carries notGuest so they cannot mint a board. This route bypasses
// that rule, so it has to refuse them itself.
func TestImportEndpoint_RefusesAGuest(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/boards/import",
		token:  env.guestToken,
		body:   string(trelloFixtureBytes(t)),
		want:   http.StatusForbidden,
		before: mountImportRoutes,
	}.run(t, env)
}

func TestImportEndpoint_RefusesAnAnonymousCaller(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/boards/import",
		body:   string(trelloFixtureBytes(t)),
		want:   http.StatusUnauthorized,
		before: mountImportRoutes,
	}.run(t, env)
}

func TestImportEndpoint_RefusesADisabledAccount(t *testing.T) {
	env := setupCardsEnv(t)
	env.owner.Set("disabled", true)
	if err := env.app.Save(env.owner); err != nil {
		t.Fatal(err)
	}

	req{
		method: http.MethodPost,
		url:    "/api/boards/import",
		token:  env.ownerToken,
		body:   string(trelloFixtureBytes(t)),
		want:   http.StatusForbidden,
		before: mountImportRoutes,
	}.run(t, env)
}

func TestImportEndpoint_RefusesAFileThatIsNotABoard(t *testing.T) {
	env := setupCardsEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/boards/import",
		token:  env.ownerToken,
		body:   `{"hello":"world"}`,
		want:   http.StatusBadRequest,
		before: mountImportRoutes,
	}.run(t, env)
}

// The round trip the JSON export exists for: export a board, import it back,
// and the second board must hold what the first did.
//
// This is what the CSV cannot do — it carries no checklists, comments or links
// — and why a JSON export shipped beside it.
func TestImportEndpoint_RoundTripsAnExportedBoard(t *testing.T) {
	env := setupCardsEnv(t)
	seedExportBoard(t, env)
	cardsComment(t, env.app, env.project, env.card, env.owner, "a comment that must survive")
	env.list.Set("wip_limit", 6)
	if err := env.app.Save(env.list); err != nil {
		t.Fatalf("set the limit: %v", err)
	}

	original, err := collectBoard(env.app, env.project)
	if err != nil {
		t.Fatal(err)
	}
	exported, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}

	result := importBoard(t, env, env.ownerToken, exported, "?name=Round+trip")

	if result.Lists != len(original.Lists) {
		t.Errorf("lists = %d, want %d", result.Lists, len(original.Lists))
	}
	if result.Cards != len(original.Cards) {
		t.Errorf("cards = %d, want %d", result.Cards, len(original.Cards))
	}
	if result.Labels != len(original.Labels) {
		t.Errorf("labels = %d, want %d", result.Labels, len(original.Labels))
	}
	if result.Comments != 1 {
		t.Errorf("comments = %d, want the one that was there", result.Comments)
	}
	if result.ArchivedCards != 0 {
		// The archived flag travels, but the report's count comes from the
		// Trello parser; our own format reports none. Stated so the difference
		// is deliberate rather than discovered.
		t.Errorf("archived report = %d, want 0 for our own format", result.ArchivedCards)
	}

	// Re-export the copy and compare the parts that must survive. Ids, ranks
	// and keys are legitimately new; titles, categories and structure are not.
	copyProject, err := env.app.FindRecordById("boards_projects", result.Project)
	if err != nil {
		t.Fatal(err)
	}
	copied, err := collectBoard(env.app, copyProject)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := titlesOf(copied), titlesOf(original); got != want {
		t.Errorf("card titles after the round trip = %s, want %s", got, want)
	}
	if got, want := categoriesOf(copied), categoriesOf(original); got != want {
		t.Errorf("list categories after the round trip = %s, want %s", got, want)
	}
	// A limit is a setting the team chose, so it travels with the board the
	// same way a category does.
	limits := 0
	for _, l := range copied.Lists {
		if l.WipLimit == 6 {
			limits++
		}
	}
	if limits != 1 {
		t.Errorf("the WIP limit did not survive the round trip: %d lists carry it", limits)
	}
	// The archived card is still archived — an export doubles as a backup, so
	// restoring one must not quietly resurrect finished work.
	archived := 0
	for _, c := range copied.Cards {
		if c.Archived {
			archived++
		}
	}
	if archived != 1 {
		t.Errorf("archived cards after the round trip = %d, want 1", archived)
	}
}

// The file is user-supplied, so an out-of-range limit must not fail the list's
// save and lose the column. It lands as 0 — no limit — rather than rejecting
// the import over a decorative field.
func TestImportEndpoint_ClampsAHostileWipLimit(t *testing.T) {
	env := setupCardsEnv(t)

	body := `{"name":"Hostile","lists":[` +
		`{"id":"l1","name":"Way over","position":"a0","category":"todo","wip_limit":100000},` +
		`{"id":"l2","name":"Negative","position":"a1","category":"todo","wip_limit":-5}` +
		`],"cards":[],"labels":[]}`

	result := importBoard(t, env, env.ownerToken, []byte(body), "")
	if result.Lists != 2 {
		t.Fatalf("lists = %d, want both to survive the clamp", result.Lists)
	}

	rows, err := env.app.FindAllRecords("boards_lists", dbx.HashExp{"project": result.Project})
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if got := row.GetInt("wip_limit"); got != 0 {
			t.Errorf("%q kept an out-of-range limit: %d", row.GetString("name"), got)
		}
	}
}

func titlesOf(board exportedBoard) string {
	var out []string
	for _, c := range board.Cards {
		out = append(out, c.Title)
	}
	return strings.Join(out, "|")
}

func categoriesOf(board exportedBoard) string {
	var out []string
	for _, l := range board.Lists {
		out = append(out, l.Name+"="+l.Category)
	}
	return strings.Join(out, "|")
}
