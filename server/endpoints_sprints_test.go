package boards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// The sprint endpoints, mounted through the SAME route table production
// binds, on an env with the sprint hooks live.

func mountSprintRoutes(e *core.ServeEvent) { bindSprintRoutes(e) }

func TestStartSprintEndpoint_EditorStarts(t *testing.T) {
	env := setupLifecycleEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")

	req{
		method:  http.MethodPost,
		url:     "/api/boards/sprints/" + sprint.Id + "/start",
		token:   env.editorToken,
		body:    `{"start":"2026-09-07","end":"2026-09-20","goal":"Ship it"}`,
		want:    http.StatusOK,
		content: []string{`"state":"active"`, `"goal":"Ship it"`},
		before:  mountSprintRoutes,
	}.run(t, env.cardsEnv)
}

// A viewer is a member and gets 403; an outsider cannot tell the sprint
// exists and gets 404 — the move endpoint's discipline.
func TestStartSprintEndpoint_ViewerForbidden(t *testing.T) {
	env := setupLifecycleEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")

	req{
		method: http.MethodPost,
		url:    "/api/boards/sprints/" + sprint.Id + "/start",
		token:  env.viewerToken,
		want:   http.StatusForbidden,
		before: mountSprintRoutes,
	}.run(t, env.cardsEnv)
}

func TestStartSprintEndpoint_OutsiderNotFound(t *testing.T) {
	env := setupLifecycleEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")

	req{
		method: http.MethodPost,
		url:    "/api/boards/sprints/" + sprint.Id + "/start",
		token:  env.outsiderToken,
		want:   http.StatusNotFound,
		before: mountSprintRoutes,
	}.run(t, env.cardsEnv)
}

func TestStartSprintEndpoint_RefusesASecondActiveSprint(t *testing.T) {
	env := setupLifecycleEnv(t)
	first := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	if err := startSprint(env.app, first, env.now, sprintStartOptions{}); err != nil {
		t.Fatal(err)
	}
	second := cardsSprint(t, env.app, env.project, "Sprint two", "a1")

	req{
		method: http.MethodPost,
		url:    "/api/boards/sprints/" + second.Id + "/start",
		token:  env.editorToken,
		want:   http.StatusBadRequest,
		before: mountSprintRoutes,
	}.run(t, env.cardsEnv)
}

// Ask, don't pick: unfinished cards and no answer is a 400 naming the choices.
func TestCompleteSprintEndpoint_AsksWhereUnfinishedCardsGo(t *testing.T) {
	env := setupLifecycleEnv(t)
	sprint, _, _, _ := seedActive(t, env)

	req{
		method:  http.MethodPost,
		url:     "/api/boards/sprints/" + sprint.Id + "/complete",
		token:   env.editorToken,
		body:    `{}`,
		want:    http.StatusBadRequest,
		content: []string{`unfinished`},
		before:  mountSprintRoutes,
		after: func(t testing.TB, app *tests.TestApp) {
			s, _ := app.FindRecordById("boards_sprints", sprint.Id)
			if s.GetString("state") != sprintActive {
				t.Fatal("the refusal completed the sprint")
			}
		},
	}.run(t, env.cardsEnv)
}

func TestCompleteSprintEndpoint_RollsToTheBacklog(t *testing.T) {
	env := setupLifecycleEnv(t)
	sprint, _, open1, _ := seedActive(t, env)

	req{
		method:  http.MethodPost,
		url:     "/api/boards/sprints/" + sprint.Id + "/complete",
		token:   env.editorToken,
		body:    `{"unfinished":"backlog"}`,
		want:    http.StatusOK,
		content: []string{`"completed_count":1`, `"rolled_count":2`, `"target_sprint":""`, `"created_sprint":false`},
		before:  mountSprintRoutes,
		after:   requireCardSprint(open1.Id, ""),
	}.run(t, env.cardsEnv)
}

func TestCompleteSprintEndpoint_NextNeedsAPlannedSprint(t *testing.T) {
	env := setupLifecycleEnv(t)
	sprint, _, _, _ := seedActive(t, env)

	req{
		method: http.MethodPost,
		url:    "/api/boards/sprints/" + sprint.Id + "/complete",
		token:  env.editorToken,
		body:   `{"unfinished":"next"}`,
		want:   http.StatusBadRequest,
		before: mountSprintRoutes,
	}.run(t, env.cardsEnv)
}

func TestCompleteSprintEndpoint_NewReportsTheCreatedSprint(t *testing.T) {
	env := setupLifecycleEnv(t)
	sprint, _, _, _ := seedActive(t, env)

	req{
		method:  http.MethodPost,
		url:     "/api/boards/sprints/" + sprint.Id + "/complete",
		token:   env.editorToken,
		body:    `{"unfinished":"new"}`,
		want:    http.StatusOK,
		content: []string{`"created_sprint":true`, `"rolled_count":2`},
		before:  mountSprintRoutes,
	}.run(t, env.cardsEnv)
}

// The stamps the transitions write survive the route: a client PATCH after
// a start cannot forge them (sprint_owned_columns.go), but the endpoint's
// own write must land — proven by reading them back.
func TestStartSprintEndpoint_StampsSurviveTheOwnedColumnGuard(t *testing.T) {
	env := setupLifecycleEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	sprintCard(t, env.cardsEnv, sprint, env.list, "sized", "a1", 8)

	req{
		method:  http.MethodPost,
		url:     "/api/boards/sprints/" + sprint.Id + "/start",
		token:   env.ownerToken,
		want:    http.StatusOK,
		content: []string{`"committed_points":8`},
		before:  mountSprintRoutes,
		after:   requireSprintInt(sprint.Id, "committed_points", 8),
	}.run(t, env.cardsEnv)
}

// The seed drives the transitions as a superuser, which is no board's
// member: admitted, and attributed to nobody.
func TestSprintEndpoints_SuperuserActsAsNobody(t *testing.T) {
	env := setupLifecycleEnv(t)
	sprint, _, open1, _ := seedActive(t, env)
	token := superuserToken(t, env.app)

	req{
		method:  http.MethodPost,
		url:     "/api/boards/sprints/" + sprint.Id + "/complete",
		token:   token,
		body:    `{"unfinished":"backlog"}`,
		want:    http.StatusOK,
		content: []string{`"rolled_count":2`},
		before:  mountSprintRoutes,
		after: func(t testing.TB, app *tests.TestApp) {
			requireCardSprint(open1.Id, "")(t, app)
			rows, err := app.FindRecordsByFilter("boards_activity",
				"card = {:card} && kind = 'sprint'", "", 0, 0, dbx.Params{"card": open1.Id})
			if err != nil {
				t.Fatal(err)
			}
			if len(rows) != 1 || rows[0].GetString("actor") != "" {
				t.Fatalf("history = %d rows, actor %q; want one unattributed row", len(rows), rows[0].GetString("actor"))
			}
		},
	}.run(t, env.cardsEnv)
}

func superuserToken(t *testing.T, app core.App) string {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	su := core.NewRecord(col)
	su.SetEmail("root@example.com")
	su.SetPassword("password-long-enough")
	if err := app.Save(su); err != nil {
		t.Fatal(err)
	}
	token, err := su.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	return token
}
