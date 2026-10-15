package boards

import (
	"encoding/json"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// bugDefinitionJSON is a card type as the form builder saves it: the card
// host's built-ins on one page, then the custom fields a "Bug" type adds. Two
// of those are collaborative, so their text lives in the board's document and
// reaches `fields` through the flush.
const bugDefinitionJSON = `{
	"version": 1,
	"pages": [{ "key": "main", "title": "Main" }],
	"fields": [
		{ "key": "title", "kind": "builtin", "page": "main", "label": "Title", "width": "full", "required": true },
		{ "key": "reporter", "kind": "builtin", "page": "main", "label": "Reporter", "width": "full" },
		{ "key": "assignees", "kind": "builtin", "page": "main", "label": "Assignees", "width": "full" },
		{ "key": "labels", "kind": "builtin", "page": "main", "label": "Labels", "width": "full" },
		{ "key": "epic", "kind": "builtin", "page": "main", "label": "Epic", "width": "full" },
		{ "key": "sprint", "kind": "builtin", "page": "main", "label": "Sprint", "width": "full" },
		{ "key": "start", "kind": "builtin", "page": "main", "label": "Start", "width": "full" },
		{ "key": "due", "kind": "builtin", "page": "main", "label": "Due", "width": "full" },
		{ "key": "priority", "kind": "builtin", "page": "main", "label": "Priority", "width": "full" },
		{ "key": "estimate", "kind": "builtin", "page": "main", "label": "Estimate", "width": "full" },
		{ "key": "reactions", "kind": "builtin", "page": "main", "label": "Reactions", "width": "full" },
		{ "key": "description", "kind": "builtin", "page": "main", "label": "Description", "width": "full" },
		{ "key": "chips", "kind": "builtin", "page": "main", "label": "Section chips", "width": "full" },
		{ "key": "attachments", "kind": "builtin", "page": "main", "label": "Attachments", "width": "full" },
		{ "key": "checklist", "kind": "builtin", "page": "main", "label": "Checklist", "width": "full" },
		{ "key": "subtasks", "kind": "builtin", "page": "main", "label": "Sub-tasks", "width": "full" },
		{ "key": "prs", "kind": "builtin", "page": "main", "label": "Pull requests", "width": "full" },
		{ "key": "links", "kind": "builtin", "page": "main", "label": "Links", "width": "full" },
		{ "key": "activity", "kind": "builtin", "page": "main", "label": "Activity", "width": "full" },
		{ "key": "severity", "kind": "select", "page": "main", "label": "Severity",
			"options": [{ "value": "low", "label": "Low" }, { "value": "high", "label": "High" }] },
		{ "key": "steps", "kind": "markdown", "page": "main", "label": "Steps", "collaborative": true },
		{ "key": "notes", "kind": "richtext", "page": "main", "label": "Notes", "collaborative": true }
	],
	"rules": [],
	"defaults": {},
	"submit": { "required": [] }
}`

// cardsForm writes a card type into the stubbed core forms collection.
func cardsForm(t *testing.T, app core.App, definitionJSON string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("forms")
	if err != nil {
		t.Fatalf("find forms: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("host", "boards:card")
	r.Set("name", "Bug")
	r.Set("slug", "bug")
	r.Set("definition", definitionJSON)
	if err := app.Save(r); err != nil {
		t.Fatalf("save form: %v", err)
	}
	return r
}

// cardsCardOfForm is a card on the fixture's board whose type is form.
func cardsCardOfForm(t *testing.T, env *cardsEnv, title string, form *core.Record) *core.Record {
	t.Helper()
	card := cardsCard(t, env.app, env.project, env.list, title, "a5", env.owner)
	card.Set("form", form.Id)
	if err := env.app.Save(card); err != nil {
		t.Fatalf("set form on %s: %v", title, err)
	}
	return card
}

// setFields stores custom values on a card, the way a REST write would.
func setFields(t *testing.T, app core.App, card *core.Record, fields map[string]any) {
	t.Helper()
	card.Set("fields", fields)
	if err := app.Save(card); err != nil {
		t.Fatalf("set fields on %s: %v", card.Id, err)
	}
}

// fieldsOf reads a card's custom values back from the database.
func fieldsOf(t *testing.T, env *cardsEnv, cardID string) map[string]any {
	t.Helper()
	record, err := env.app.FindRecordById("boards_cards", cardID)
	if err != nil {
		t.Fatalf("load card %s: %v", cardID, err)
	}
	raw, err := json.Marshal(record.Get("fields"))
	if err != nil {
		t.Fatalf("encode fields of %s: %v", cardID, err)
	}
	var fields map[string]any
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatalf("decode fields of %s: %v", cardID, err)
	}
	if fields == nil {
		fields = map[string]any{}
	}
	return fields
}
