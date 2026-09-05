package boards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

// The server-owned columns on boards_sprints: zeroed on a client create,
// restored on a client update, written by the server alone.

func requireSprintInt(sprintID, column string, want int) func(t testing.TB, app *tests.TestApp) {
	return func(t testing.TB, app *tests.TestApp) {
		sprint, err := app.FindRecordById("boards_sprints", sprintID)
		if err != nil {
			t.Fatalf("reload sprint: %v", err)
		}
		if got := sprint.GetInt(column); got != want {
			t.Fatalf("%s = %d, want %d", column, got, want)
		}
	}
}

func TestSprintOwnedColumns_AClientCreateIsZeroed(t *testing.T) {
	env := setupSprintEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_sprints/records",
		token:  env.editorToken,
		body: `{"project":"` + env.project.Id +
			`","name":"Forged","position":"a0","state":"planned","committed_points":40,"points_done":9,"started_at":"2026-09-01 00:00:00.000Z"}`,
		want:    http.StatusOK,
		content: []string{`"committed_points":0`, `"points_done":0`, `"started_at":""`},
	}.run(t, env)
}

func TestSprintOwnedColumns_AClientUpdateIsRestored(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	sprint.Set("committed_points", 40)
	if err := saveSprintAsServer(env.app, sprint); err != nil {
		t.Fatalf("stamp: %v", err)
	}

	req{
		method:  http.MethodPatch,
		url:     "/api/collections/boards_sprints/records/" + sprint.Id,
		token:   env.editorToken,
		body:    `{"name":"Renamed","committed_points":1}`,
		want:    http.StatusOK,
		content: []string{`"name":"Renamed"`, `"committed_points":40`},
		after:   requireSprintInt(sprint.Id, "committed_points", 40),
	}.run(t, env)
}

func TestSprintOwnedColumns_AServerWriteLands(t *testing.T) {
	env := setupSprintEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")

	fresh, _ := env.app.FindRecordById("boards_sprints", sprint.Id)
	fresh.Set("points_total", 5)
	if err := saveSprintAsServer(env.app, fresh); err != nil {
		t.Fatalf("server save: %v", err)
	}
	requireSprintInt(sprint.Id, "points_total", 5)(t, env.app)
}
