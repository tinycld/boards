package boards

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// The two sprint transitions as endpoints. Neither is expressible as a
// collection write: a start stamps the commitment the client must not write
// (sprint_owned_columns.go), and a completion re-files N cards and stamps
// the sprint in one transaction. So each is an endpoint that restates the
// authorization in Go — endpoints_move_card.go's shape, including its
// 404-vs-403 discipline: a non-member cannot tell the sprint exists.
//
// Both are classified in core's oauth route table under boards:write.

type startSprintRequest struct {
	Start string `json:"start"`
	End   string `json:"end"`
	Name  string `json:"name"`
	Goal  string `json:"goal"`
}

type completeSprintRequest struct {
	// Where the unfinished cards go: "next", "new" or "backlog". Required
	// whenever there are any — the endpoint refuses rather than guessing,
	// for the reason a cross-board move's `family` does. A sprint with
	// nothing unfinished needs no answer.
	Unfinished string `json:"unfinished"`
	// The planned sprint to roll into, for "next".
	NextSprint string `json:"next_sprint"`
}

type completeSprintResponse struct {
	Sprint          map[string]any `json:"sprint"`
	CompletedCount  int            `json:"completed_count"`
	CompletedPoints int            `json:"completed_points"`
	RolledCount     int            `json:"rolled_count"`
	// The sprint the unfinished cards landed in, "" for the backlog — so the
	// client can say what happened rather than guessing from what it asked.
	TargetSprint  string `json:"target_sprint"`
	CreatedSprint bool   `json:"created_sprint"`
}

func bindSprintRoutes(e *core.ServeEvent) {
	e.Router.POST("/api/boards/sprints/{id}/start", func(re *core.RequestEvent) error {
		return handleStartSprint(e.App, re)
	}).BindFunc(requireAuth)
	e.Router.POST("/api/boards/sprints/{id}/complete", func(re *core.RequestEvent) error {
		return handleCompleteSprint(e.App, re)
	}).BindFunc(requireAuth)
}

// loadWritableSprint answers the authorization every sprint endpoint makes:
// the caller is a writer on the sprint's board. A non-member gets the 404 a
// read would give; a member without write gets 403.
func loadWritableSprint(app core.App, re *core.RequestEvent) (*core.Record, error) {
	sprint, err := app.FindRecordById("boards_sprints", re.Request.PathValue("id"))
	if err != nil {
		return nil, re.NotFoundError("sprint not found", nil)
	}
	// A superuser bypasses every collection rule, and the seed drives the
	// transitions through these routes precisely because the stamps they
	// write are refused on a plain record write (sprint_owned_columns.go).
	if re.Auth.IsSuperuser() {
		return sprint, nil
	}
	project := sprint.GetString("project")
	if !isProjectWriter(app, project, re.Auth.Id) {
		if member, _ := app.CountRecords("boards_project_members",
			dbx.HashExp{"project": project, "user": re.Auth.Id}); member == 0 {
			return nil, re.NotFoundError("sprint not found", nil)
		}
		return nil, re.ForbiddenError("only an editor or owner can change a sprint", nil)
	}
	return sprint, nil
}

func handleStartSprint(app core.App, re *core.RequestEvent) error {
	// An empty body is a start with the sprint's own dates and words.
	var body startSprintRequest
	if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
		return re.BadRequestError("invalid request body", nil)
	}
	sprint, err := loadWritableSprint(app, re)
	if err != nil {
		return err
	}
	// The actor, for the history the start itself writes nothing of but
	// the notification names.
	pendingActors.Store(sprint, actorFor(re))
	defer pendingActors.Delete(sprint)
	if err := startSprint(app, sprint, time.Now(), sprintStartOptions{
		Start: body.Start, End: body.End, Name: body.Name, Goal: body.Goal,
	}); err != nil {
		return re.BadRequestError(err.Error(), nil)
	}
	fresh, err := app.FindRecordById("boards_sprints", sprint.Id)
	if err != nil {
		return re.InternalServerError("failed to reload sprint", err)
	}
	return re.JSON(http.StatusOK, fresh.PublicExport())
}

func handleCompleteSprint(app core.App, re *core.RequestEvent) error {
	var body completeSprintRequest
	if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
		return re.BadRequestError("invalid request body", nil)
	}
	sprint, err := loadWritableSprint(app, re)
	if err != nil {
		return err
	}
	if sprint.GetString("state") != sprintActive {
		return re.BadRequestError("only an active sprint can be completed", nil)
	}

	unfinished, err := unfinishedSprintCards(app, sprint.Id)
	if err != nil {
		return re.InternalServerError("failed to read the sprint's cards", err)
	}
	if len(unfinished) > 0 {
		switch body.Unfinished {
		case rolloverNext, rolloverNew, rolloverBacklog:
		default:
			return re.BadRequestError(fmt.Sprintf(
				`this sprint has %d unfinished %s; unfinished must be "next", "new" or "backlog"`,
				len(unfinished), plural(len(unfinished), "card", "cards")), nil)
		}
		if body.Unfinished == rolloverNext {
			if _, err := plannedSprintOnBoard(app, sprint.GetString("project"), body.NextSprint); err != nil {
				return re.BadRequestError(err.Error(), nil)
			}
		}
	}

	actor := actorFor(re)
	pendingActors.Store(sprint, actor)
	defer pendingActors.Delete(sprint)
	result, err := completeSprint(app, sprint, time.Now(), actor, sprintRollover{
		Target: body.Unfinished, SprintID: body.NextSprint,
	})
	if err != nil {
		if errors.Is(err, errRolloverRequired) {
			return re.BadRequestError(err.Error(), nil)
		}
		return re.InternalServerError("failed to complete sprint", err)
	}
	fresh, err := app.FindRecordById("boards_sprints", sprint.Id)
	if err != nil {
		return re.InternalServerError("failed to reload sprint", err)
	}
	return re.JSON(http.StatusOK, completeSprintResponse{
		Sprint:          fresh.PublicExport(),
		CompletedCount:  result.CompletedCount,
		CompletedPoints: result.CompletedPoints,
		RolledCount:     result.RolledCount,
		TargetSprint:    result.TargetSprintID,
		CreatedSprint:   result.CreatedSprint,
	})
}

// actorFor is who a transition is attributed to. A superuser is not a
// `users` row, and both the history and the notice relate to one, so it acts
// as nobody — the shape the sweep's own transitions take.
func actorFor(re *core.RequestEvent) string {
	if re.Auth == nil || re.Auth.IsSuperuser() {
		return ""
	}
	return re.Auth.Id
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}
