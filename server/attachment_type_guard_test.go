package boards

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

// The Attachments built-in, hidden outright.
var noAttachmentsDefinitionJSON = strings.Replace(bugDefinitionJSON,
	`"label": "Attachments", "width": "full" }`,
	`"label": "Attachments", "width": "full", "hidden": true }`, 1)

// The Attachments built-in, hidden by a rule while severity is high.
var ruleHidesAttachmentsJSON = strings.Replace(bugDefinitionJSON,
	`"rules": []`,
	`"rules": [{ "key": "r1", "match": "all",
		"when": [{ "field": "severity", "op": "eq", "value": "high" }],
		"actions": [{ "action": "hide", "field": "attachments" }] }]`, 1)

func setupAttachmentGuard(t *testing.T) *cardsEnv {
	t.Helper()
	env := setupCardsEnv(t)
	registerAttachmentTypeGuard(env.app)
	return env
}

// postAttachment uploads one file to card as the editor. `field` is empty for
// a plain attachment and names a file field otherwise.
func postAttachment(t *testing.T, env *cardsEnv, card, field string, want int) {
	t.Helper()
	body, mp, err := tests.MockMultipartData(map[string]string{
		"project":     env.project.Id,
		"card":        card,
		"uploaded_by": env.editor.Id,
		"size":        "4",
		"field":       field,
	}, "file")
	if err != nil {
		t.Fatalf("build multipart body: %v", err)
	}
	content := []string{`"card":"` + card + `"`}
	if want != http.StatusOK {
		content = []string{`no attachments`}
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
	scenario.Test(t)
}

func TestAttachmentGuard_TypeThatHidesAttachmentsRefusesAPlainFile(t *testing.T) {
	env := setupAttachmentGuard(t)
	card := cardsCardOfForm(t, env, "hidden", cardsForm(t, env.app, noAttachmentsDefinitionJSON))
	postAttachment(t, env, card.Id, "", http.StatusBadRequest)
}

func TestAttachmentGuard_TypeThatHidesAttachmentsAcceptsAFieldUpload(t *testing.T) {
	env := setupAttachmentGuard(t)
	card := cardsCardOfForm(t, env, "hidden", cardsForm(t, env.app, noAttachmentsDefinitionJSON))
	postAttachment(t, env, card.Id, "evidence", http.StatusOK)
}

func TestAttachmentGuard_DefaultCardAcceptsAPlainFile(t *testing.T) {
	env := setupAttachmentGuard(t)
	postAttachment(t, env, env.card.Id, "", http.StatusOK)
}

func TestAttachmentGuard_TypeThatShowsAttachmentsAcceptsAPlainFile(t *testing.T) {
	env := setupAttachmentGuard(t)
	card := cardsCardOfForm(t, env, "shown", cardsForm(t, env.app, ruleHidesAttachmentsJSON))
	setFields(t, env.app, card, map[string]any{"severity": "low"})
	postAttachment(t, env, card.Id, "", http.StatusOK)
}

func TestAttachmentGuard_RuleThatHidesAttachmentsRefusesAPlainFile(t *testing.T) {
	env := setupAttachmentGuard(t)
	card := cardsCardOfForm(t, env, "ruled", cardsForm(t, env.app, ruleHidesAttachmentsJSON))
	setFields(t, env.app, card, map[string]any{"severity": "high"})
	postAttachment(t, env, card.Id, "", http.StatusBadRequest)
}

// A card with no type is shown with the default type, so the default type's
// choice is the one enforced.
func TestAttachmentGuard_UntypedCardFollowsTheDefaultType(t *testing.T) {
	env := setupAttachmentGuard(t)
	form := cardsForm(t, env.app, noAttachmentsDefinitionJSON)
	form.Set("is_default", true)
	if err := env.app.Save(form); err != nil {
		t.Fatalf("make the type the default: %v", err)
	}
	postAttachment(t, env, env.card.Id, "", http.StatusBadRequest)
}
