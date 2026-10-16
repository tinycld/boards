package boards

import (
	"slices"
	"testing"
)

// seedableCards loads only the cards with stored text a board document would
// hold. Every card names a type once the forms backfill has run, so a type
// alone must not load a card: one with no custom values and no description has
// nothing to seed.
func TestSeedableCards_SkipsATypedCardWithNothingStored(t *testing.T) {
	env := setupCardsEnv(t)
	form := cardsForm(t, env.app, bugDefinitionJSON)

	bare := cardsCardOfForm(t, env, "typed-empty", form)
	setFields(t, env.app, bare, map[string]any{})
	neverSet := cardsCardOfForm(t, env, "typed-never-set", form)
	withNotes := cardsCardOfForm(t, env, "typed-with-notes", form)
	setFields(t, env.app, withNotes, map[string]any{"notes": "<p>hi</p>"})
	described := cardsCard(t, env.app, env.project, env.list, "described", "a6", env.owner)
	described.Set("description", "stored prose")
	if err := env.app.Save(described); err != nil {
		t.Fatal(err)
	}

	records, err := seedableCards(env.app, env.project.Id)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, r := range records {
		ids = append(ids, r.Id)
	}
	for _, skipped := range []string{bare.Id, neverSet.Id, env.card.Id} {
		if slices.Contains(ids, skipped) {
			t.Errorf("card %s has nothing to seed but was loaded", skipped)
		}
	}
	for _, loaded := range []string{withNotes.Id, described.Id} {
		if !slices.Contains(ids, loaded) {
			t.Errorf("card %s has stored text but was not loaded", loaded)
		}
	}
}
