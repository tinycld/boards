package boards

import (
	"strings"
	"testing"

	"github.com/pocketbase/dbx"

	"tinycld.org/core/search"
)

// The search index holds a card's custom text in its own column. These pin
// what of `fields` is worth finding: words a person typed or chose, never
// keys, ids or markup.

func TestCustomFieldsText_IndexesTypedAndChosenText(t *testing.T) {
	env := setupCardsEnv(t)
	form := cardsForm(t, env.app, bugDefinitionJSON)
	card := cardsCardOfForm(t, env, "Typed", form)
	setFields(t, env.app, card, map[string]any{
		"steps":    "**bold** words",
		"notes":    "<p>Tom &amp; Jerry</p>",
		"severity": "high",
	})

	got := strings.Join(strings.Fields(customFieldsText(env.app)(card)), " ")
	if got != "High bold words Tom & Jerry" {
		t.Errorf("indexed text = %q", got)
	}
}

func TestCustomFieldsText_ACardWithNoTypeIndexesNothing(t *testing.T) {
	env := setupCardsEnv(t)
	setFields(t, env.app, env.card, map[string]any{"steps": "orphan"})
	if got := customFieldsText(env.app)(env.card); got != "" {
		t.Errorf("indexed text = %q", got)
	}
}

func TestCustomFieldsText_SkipsKeysTheFormDoesNotDeclare(t *testing.T) {
	env := setupCardsEnv(t)
	form := cardsForm(t, env.app, bugDefinitionJSON)
	card := cardsCardOfForm(t, env, "Typed", form)
	setFields(t, env.app, card, map[string]any{"ghost": "hidden", "severity": "unknown"})
	if got := customFieldsText(env.app)(card); got != "" {
		t.Errorf("indexed text = %q", got)
	}
}

func TestFTSConfig_IndexesTheFieldsColumn(t *testing.T) {
	// The migration's table and the config's columns must agree, or every
	// card write logs a failed index insert and custom text is never found.
	env := setupCardsEnv(t)
	cfg := ftsConfigFor(env.app)
	var names []string
	for _, c := range cfg.Columns {
		names = append(names, c.FTS)
	}
	if strings.Join(names, ",") != "title,description,fields" {
		t.Fatalf("columns = %v", names)
	}
	if _, err := env.app.DB().NewQuery(
		"INSERT INTO fts_boards (record_id, title, description, fields) VALUES ('x', 't', 'd', 'f')",
	).Execute(); err != nil {
		t.Fatalf("the migrated table lacks a fields column: %v", err)
	}
}

func TestSearchFindsATypedCardsFieldText(t *testing.T) {
	env := setupCardsEnv(t)
	form := cardsForm(t, env.app, bugDefinitionJSON)
	card := cardsCardOfForm(t, env, "Typed", form)
	setFields(t, env.app, card, map[string]any{"steps": "kraken", "ghost": "leviathan"})
	// The test app binds no sync hooks, so the row is indexed the way they do:
	// through the column's own text extractor.
	if _, err := env.app.DB().NewQuery(
		"INSERT INTO fts_boards (record_id, title, description, fields) VALUES ({:id}, {:t}, '', {:f})",
	).Bind(dbx.Params{"id": card.Id, "t": card.GetString("title"), "f": customFieldsText(env.app)(card)}).Execute(); err != nil {
		t.Fatalf("index card: %v", err)
	}

	found, err := searchCards(env.app, env.owner.Id, search.Query{Include: []string{"kraken"}, Limit: 25})
	if err != nil {
		t.Fatalf("searchCards: %v", err)
	}
	if len(found.Rows) != 1 || found.Rows[0].ID != card.Id {
		t.Fatalf("rows = %+v, want the typed card", found.Rows)
	}

	missed, err := searchCards(env.app, env.owner.Id, search.Query{Include: []string{"leviathan"}, Limit: 25})
	if err != nil {
		t.Fatalf("searchCards: %v", err)
	}
	if len(missed.Rows) != 0 {
		t.Errorf("an undeclared key was indexed: %+v", missed.Rows)
	}
}
