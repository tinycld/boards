package boards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/tests"
)

// A checklist item, an attachment and a comment are created on their card's
// board (2090000102, 2090000103). Every rule reads the row's own `project`, so
// without the pin a writer on board A could hang a row stamped project = A off
// a card of board B: B's card counts it while B's members cannot read it.
//
// Each refusal is paired with a positive control on the writer's own card, so
// the pin is what refuses, not the request's shape; and with a re-read, so a
// row written before a refusal would still fail the test.

type childPinEnv struct {
	*cardsEnv
	foreignCard string
}

// setupChildPin is cardsEnv's editor (a writer on A) and a card on board B,
// where neither the editor nor the commentor holds a membership.
func setupChildPin(t *testing.T) *childPinEnv {
	t.Helper()
	env := setupCardsEnv(t)
	b := cardsProject(t, env.app, "Foreign", env.outsider)
	cardsMember(t, env.app, b, env.outsider, "owner")
	list := cardsList(t, env.app, b, "Foreign list", "a0")
	card := cardsCard(t, env.app, b, list, "foreign-card", "a0", env.outsider)
	return &childPinEnv{cardsEnv: env, foreignCard: card.Id}
}

func requireNoChildRows(collection, cardID string) func(testing.TB, *tests.TestApp) {
	return func(t testing.TB, app *tests.TestApp) {
		rows, err := app.FindAllRecords(collection, dbx.HashExp{"card": cardID})
		if err != nil {
			t.Fatalf("re-read %s: %v", collection, err)
		}
		if len(rows) != 0 {
			t.Fatalf("%s holds %d rows on card %s — the write landed despite the refusal", collection, len(rows), cardID)
		}
	}
}

func checklistBody(project, card string) string {
	return `{"project":"` + project + `","card":"` + card + `","title":"pinned","position":"a0"}`
}

func TestCardsChildPin_WriterCannotAddAChecklistItemToAnotherBoardsCard(t *testing.T) {
	env := setupChildPin(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_checklist_items/records",
		token:  env.editorToken,
		body:   checklistBody(env.project.Id, env.foreignCard),
		want:   http.StatusBadRequest,
		after:  requireNoChildRows("boards_checklist_items", env.foreignCard),
	}.run(t, env.cardsEnv)
}

func TestCardsChildPin_WriterAddsAChecklistItemToTheirOwnCard(t *testing.T) {
	env := setupChildPin(t)
	req{
		method:  http.MethodPost,
		url:     "/api/collections/boards_checklist_items/records",
		token:   env.editorToken,
		body:    checklistBody(env.project.Id, env.card.Id),
		want:    http.StatusOK,
		content: []string{`"title":"pinned"`},
	}.run(t, env.cardsEnv)
}

// attachmentScenario posts a one-file attachment as the editor. Attachments
// need a multipart body (the file field is required), which req does not send.
func attachmentScenario(t *testing.T, env *childPinEnv, card string, want int, content []string, after func(testing.TB, *tests.TestApp)) {
	t.Helper()
	body, mp, err := tests.MockMultipartData(map[string]string{
		"project":     env.project.Id,
		"card":        card,
		"uploaded_by": env.editor.Id,
		"size":        "4",
	}, "file")
	if err != nil {
		t.Fatalf("build multipart body: %v", err)
	}
	if len(content) == 0 {
		content = []string{`"message"`}
	}
	scenario := tests.ApiScenario{
		Name:   "POST attachment",
		Method: http.MethodPost,
		URL:    "/api/collections/boards_attachments/records",
		Body:   body,
		Headers: map[string]string{
			"Authorization": env.editorToken,
			"Content-Type":  mp.FormDataContentType(),
		},
		ExpectedStatus:        want,
		ExpectedContent:       content,
		TestAppFactory:        func(testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}
	if after != nil {
		scenario.AfterTestFunc = func(t testing.TB, app *tests.TestApp, _ *http.Response) { after(t, app) }
	}
	scenario.Test(t)
}

func TestCardsChildPin_WriterCannotAttachToAnotherBoardsCard(t *testing.T) {
	env := setupChildPin(t)
	attachmentScenario(t, env, env.foreignCard, http.StatusBadRequest, nil,
		requireNoChildRows("boards_attachments", env.foreignCard))
}

func TestCardsChildPin_WriterAttachesToTheirOwnCard(t *testing.T) {
	env := setupChildPin(t)
	attachmentScenario(t, env, env.card.Id, http.StatusOK, []string{`"card":"` + env.card.Id + `"`}, nil)
}

// A comment carries the same pin (2090000103). The commentor holds the
// lowest role that may comment on A and no membership on B.

func commentBody(project, card, author string) string {
	return `{"project":"` + project + `","card":"` + card + `","author":"` + author + `","body":"pinned"}`
}

func TestCardsChildPin_CommenterCannotCommentOnAnotherBoardsCard(t *testing.T) {
	env := setupChildPin(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/boards_comments/records",
		token:  env.commentorToken,
		body:   commentBody(env.project.Id, env.foreignCard, env.commentor.Id),
		want:   http.StatusBadRequest,
		after:  requireNoChildRows("boards_comments", env.foreignCard),
	}.run(t, env.cardsEnv)
}

func TestCardsChildPin_CommenterCommentsOnTheirOwnCard(t *testing.T) {
	env := setupChildPin(t)
	req{
		method:  http.MethodPost,
		url:     "/api/collections/boards_comments/records",
		token:   env.commentorToken,
		body:    commentBody(env.project.Id, env.card.Id, env.commentor.Id),
		want:    http.StatusOK,
		content: []string{`"body":"pinned"`},
	}.run(t, env.cardsEnv)
}
