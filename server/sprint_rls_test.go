package boards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// boards_sprints' own rules, the same-board invariant on boards_cards.sprint,
// and boards_sprint_snapshots' read-only shape.
//
// The sprint pin is the epic pin one collection over (epic_rls_test.go has the
// argument), and pinSprintProject has the same three branches, each with its
// own test:
//
//	(@request.body.sprint:isset = false   -- an ordinary PATCH, no sprint named
//	 || @request.body.sprint = ""         -- leaving a sprint
//	 || @request.body.sprint.project = project)

// cardsSprint writes one PLANNED sprint on `project`, through the server
// mark so the owned-column hook (when bound) leaves the fixture alone.
//
// A number is set explicitly for the envs that run without the allocator
// hook; when sprint_number.go IS bound it overwrites this, which is fine.
func cardsSprint(t *testing.T, app core.App, project *core.Record, name, position string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("boards_sprints")
	if err != nil {
		t.Fatalf("find boards_sprints: %v", err)
	}
	n, err := app.CountRecords("boards_sprints", dbx.HashExp{"project": project.Id})
	if err != nil {
		t.Fatalf("count sprints: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("project", project.Id)
	r.Set("number", n+1)
	r.Set("name", name)
	r.Set("position", position)
	r.Set("state", sprintPlanned)
	if err := saveSprintAsServer(app, r); err != nil {
		t.Fatalf("save sprint %s: %v", name, err)
	}
	return r
}

// advanceSprint moves a sprint to `state` the way the lifecycle does: a
// fresh load (so Original() is the stored row the guard compares against),
// the dates an active sprint needs, and a save under the server mark.
func advanceSprint(t *testing.T, app core.App, sprintID, state string) *core.Record {
	t.Helper()
	sprint, err := app.FindRecordById("boards_sprints", sprintID)
	if err != nil {
		t.Fatalf("load sprint: %v", err)
	}
	if sprint.GetString("start") == "" {
		sprint.Set("start", "2026-09-01 00:00:00.000Z")
		sprint.Set("end", "2026-09-14 00:00:00.000Z")
	}
	sprint.Set("state", state)
	if err := saveSprintAsServer(app, sprint); err != nil {
		t.Fatalf("advance sprint to %s: %v", state, err)
	}
	return sprint
}

// cardsSprintSnapshot writes one server-side snapshot row.
func cardsSprintSnapshot(t *testing.T, app core.App, project, sprint *core.Record, day string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("boards_sprint_snapshots")
	if err != nil {
		t.Fatalf("find boards_sprint_snapshots: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("project", project.Id)
	r.Set("sprint", sprint.Id)
	r.Set("day", day)
	r.Set("scope_count", 3)
	r.Set("done_count", 1)
	if err := app.Save(r); err != nil {
		t.Fatalf("save snapshot: %v", err)
	}
	return r
}

func requireCardSprint(cardID, want string) func(t testing.TB, app *tests.TestApp) {
	return func(t testing.TB, app *tests.TestApp) {
		card, err := app.FindRecordById("boards_cards", cardID)
		if err != nil {
			t.Fatalf("reload card: %v", err)
		}
		if got := card.GetString("sprint"); got != want {
			t.Fatalf("card sprint = %q, want %q", got, want)
		}
	}
}

// setupSprintEnv binds the sprint hooks production binds — guard, owned
// columns, number, rollup — so these exercise the same path a request takes.
func setupSprintEnv(t *testing.T) *cardsEnv {
	t.Helper()
	env := setupCardsEnv(t)
	registerSprintGuard(env.app)
	registerSprintOwnedColumns(env.app)
	registerSprintNumbers(env.app)
	registerSprintRollup(env.app)
	return env
}

func TestCardsSprintRLS_EditorCanFileWithinTheBoard(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")

	req{
		method:  http.MethodPatch,
		url:     "/api/collections/boards_cards/records/" + env.card.Id,
		token:   env.editorToken,
		body:    `{"sprint":"` + sprint.Id + `"}`,
		want:    http.StatusOK,
		content: []string{`"sprint":"` + sprint.Id + `"`},
	}.run(t, env)
}

// The refusal this file exists for. The stored value is asserted as well as
// the status: a status check alone would pass if PocketBase had written the
// row and then returned 404.
func TestCardsSprintRLS_EditorCannotFileOntoAnotherBoardsSprint(t *testing.T) {
	env := setupSprintEnv(t)

	other := cardsProject(t, env.app, "Other", env.owner)
	cardsMember(t, env.app, other, env.owner, "owner")
	cardsMember(t, env.app, other, env.editor, "editor")
	foreign := cardsSprint(t, env.app, other, "Their sprint", "a0")

	req{
		method: http.MethodPatch,
		url:    "/api/collections/boards_cards/records/" + env.card.Id,
		token:  env.editorToken,
		body:   `{"sprint":"` + foreign.Id + `"}`,
		want:   http.StatusNotFound,
		after:  requireCardSprint(env.card.Id, ""),
	}.run(t, env)
}

func TestCardsSprintRLS_CannotCreateWithAForeignSprint(t *testing.T) {
	env := setupSprintEnv(t)

	other := cardsProject(t, env.app, "Other", env.owner)
	cardsMember(t, env.app, other, env.owner, "owner")
	cardsMember(t, env.app, other, env.editor, "editor")
	foreign := cardsSprint(t, env.app, other, "Their sprint", "a0")

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_cards/records",
		token:  env.editorToken,
		body: `{"project":"` + env.project.Id + `","list":"` + env.list.Id +
			`","title":"smuggled","position":"a9","sprint":"` + foreign.Id + `"}`,
		want: http.StatusBadRequest,
	}.run(t, env)
}

// The `= ""` branch: leaving a sprint must stay expressible.
func TestCardsSprintRLS_EditorCanLeaveASprint(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	env.card.Set("sprint", sprint.Id)
	if err := env.app.Save(env.card); err != nil {
		t.Fatalf("seed sprint: %v", err)
	}

	req{
		method:  http.MethodPatch,
		url:     "/api/collections/boards_cards/records/" + env.card.Id,
		token:   env.editorToken,
		body:    `{"sprint":""}`,
		want:    http.StatusOK,
		content: []string{`"sprint":""`},
		after:   requireCardSprint(env.card.Id, ""),
	}.run(t, env)
}

// The `:isset = false` branch (trap 2): an edit naming no sprint is unaffected.
func TestCardsSprintRLS_AnEditWithoutSprintIsUnaffected(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	env.card.Set("sprint", sprint.Id)
	if err := env.app.Save(env.card); err != nil {
		t.Fatalf("seed sprint: %v", err)
	}

	req{
		method:  http.MethodPatch,
		url:     "/api/collections/boards_cards/records/" + env.card.Id,
		token:   env.editorToken,
		body:    `{"title":"renamed"}`,
		want:    http.StatusOK,
		content: []string{`"title":"renamed"`},
		after:   requireCardSprint(env.card.Id, sprint.Id),
	}.run(t, env)
}

func TestCardsSprintRLS_CommentorCannotFile(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")

	req{
		method: http.MethodPatch,
		url:    "/api/collections/boards_cards/records/" + env.card.Id,
		token:  env.commentorToken,
		body:   `{"sprint":"` + sprint.Id + `"}`,
		want:   http.StatusNotFound,
		after:  requireCardSprint(env.card.Id, ""),
	}.run(t, env)
}

// The collection's own rules — boards_epics': members read, writers write.

func TestCardsSprintRLS_ViewerReadsASprint(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")

	req{
		method:  http.MethodGet,
		url:     "/api/collections/boards_sprints/records/" + sprint.Id,
		token:   env.viewerToken,
		want:    http.StatusOK,
		content: []string{`"name":"Sprint one"`},
	}.run(t, env)
}

// A create through the REST API lands with the allocator's number, planned.
func TestCardsSprintRLS_EditorCreatesASprint(t *testing.T) {
	env := setupSprintEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_sprints/records",
		token:  env.editorToken,
		body: `{"project":"` + env.project.Id +
			`","name":"Sprint one","position":"a0","state":"planned","created_by":"` + env.editor.Id + `"}`,
		want:    http.StatusOK,
		content: []string{`"name":"Sprint one"`, `"number":1`, `"state":"planned"`},
	}.run(t, env)
}

func TestCardsSprintRLS_ViewerCannotCreateASprint(t *testing.T) {
	env := setupSprintEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_sprints/records",
		token:  env.viewerToken,
		body:   `{"project":"` + env.project.Id + `","name":"Nope","position":"a0","state":"planned"}`,
		want:   http.StatusBadRequest,
	}.run(t, env)
}

// A sprint is created PLANNED; a body claiming otherwise is refused by the
// guard, and nothing lands.
func TestCardsSprintRLS_CreatingAnActiveSprintIsRefused(t *testing.T) {
	env := setupSprintEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_sprints/records",
		token:  env.editorToken,
		body: `{"project":"` + env.project.Id +
			`","name":"Sneaky","position":"a0","state":"active","start":"2026-09-01","end":"2026-09-14"}`,
		want: http.StatusBadRequest,
		after: func(t testing.TB, app *tests.TestApp) {
			n, _ := app.CountRecords("boards_sprints", dbx.HashExp{"project": env.project.Id})
			if n != 0 {
				t.Fatalf("sprint rows = %d, want 0", n)
			}
		},
	}.run(t, env)
}

func TestCardsSprintRLS_OutsiderReadsNothing(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")

	req{
		method: http.MethodGet,
		url:    "/api/collections/boards_sprints/records/" + sprint.Id,
		token:  env.outsiderToken,
		want:   http.StatusNotFound,
	}.run(t, env)
}

func TestCardsSprintRLS_CannotRepointASprintToAnotherBoard(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")

	other := cardsProject(t, env.app, "Other", env.owner)
	cardsMember(t, env.app, other, env.owner, "owner")
	cardsMember(t, env.app, other, env.editor, "editor")

	req{
		method: http.MethodPatch,
		url:    "/api/collections/boards_sprints/records/" + sprint.Id,
		token:  env.editorToken,
		body:   `{"project":"` + other.Id + `"}`,
		want:   http.StatusNotFound,
	}.run(t, env)
}

// Snapshots: read by members, written by nobody. A nil create rule is
// superusers-only, which PocketBase answers with 403 rather than the 400 a
// refused rule gives — the difference between "you may not" and "no client
// may".
func TestCardsSprintRLS_OwnerCannotWriteASnapshot(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_sprint_snapshots/records",
		token:  env.ownerToken,
		body: `{"project":"` + env.project.Id + `","sprint":"` + sprint.Id +
			`","day":"2026-09-04","scope_count":99}`,
		want: http.StatusForbidden,
		after: func(t testing.TB, app *tests.TestApp) {
			n, _ := app.CountRecords("boards_sprint_snapshots", dbx.HashExp{"sprint": sprint.Id})
			if n != 0 {
				t.Fatalf("snapshot rows = %d, want 0", n)
			}
		},
	}.run(t, env)
}

func TestCardsSprintRLS_ViewerReadsSnapshots(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	row := cardsSprintSnapshot(t, env.app, env.project, sprint, "2026-09-04 00:00:00.000Z")

	req{
		method:  http.MethodGet,
		url:     "/api/collections/boards_sprint_snapshots/records",
		token:   env.viewerToken,
		want:    http.StatusOK,
		content: []string{row.Id},
	}.run(t, env)
}

func TestCardsSprintRLS_OutsiderListsNoSnapshots(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	cardsSprintSnapshot(t, env.app, env.project, sprint, "2026-09-04 00:00:00.000Z")

	req{
		method:  http.MethodGet,
		url:     "/api/collections/boards_sprint_snapshots/records",
		token:   env.outsiderToken,
		want:    http.StatusOK,
		content: emptyList,
	}.run(t, env)
}

// A share-link visitor reads the sprints of the board the link opens — the
// chip and the active-sprint scope render on a public board — and no other
// board's. The correlation clause is what keeps board B's sprint out.
func TestShareToken_LiveTokenReadsSprintsOfItsBoardOnly(t *testing.T) {
	env := setupShareTokenEnv(t)
	a := cardsSprint(t, env.app, env.project, "A sprint", "a0")
	b := cardsSprint(t, env.app, env.bProject, "B sprint", "a0")

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/boards_sprints/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		content:    []string{a.Id},
		notContent: []string{b.Id},
	}.run(t, env)
}

func TestShareToken_LiveTokenReadsSnapshotsOfItsBoardOnly(t *testing.T) {
	env := setupShareTokenEnv(t)
	a := cardsSprint(t, env.app, env.project, "A sprint", "a0")
	b := cardsSprint(t, env.app, env.bProject, "B sprint", "a0")
	aRow := cardsSprintSnapshot(t, env.app, env.project, a, "2026-09-04 00:00:00.000Z")
	bRow := cardsSprintSnapshot(t, env.app, env.bProject, b, "2026-09-04 00:00:00.000Z")

	anonReq{
		method:     http.MethodGet,
		url:        "/api/collections/boards_sprint_snapshots/records",
		shareToken: env.tokLive,
		want:       http.StatusOK,
		content:    []string{aRow.Id},
		notContent: []string{bRow.Id},
	}.run(t, env)
}
