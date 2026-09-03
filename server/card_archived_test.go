package cards

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tools/types"
)

// cards_cards.archived_at — the server-owned stamp behind the archived-items
// panel. These bind registerCardArchivedAt itself, so they cover the shipped
// hook rather than a paraphrase of it.

func TestCardArchivedAt_ArchivingStampsAndRestoringClears(t *testing.T) {
	env := setupCardsEnv(t)
	registerCardArchivedAt(env.app)

	if got := env.card.GetDateTime("archived_at"); !got.IsZero() {
		t.Fatalf("archived_at = %v on a live card, want zero", got)
	}

	fresh, err := env.app.FindRecordById("cards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload card: %v", err)
	}
	fresh.Set("archived", true)
	if err := env.app.Save(fresh); err != nil {
		t.Fatalf("archive card: %v", err)
	}
	stamped := fresh.GetDateTime("archived_at")
	if stamped.IsZero() {
		t.Fatalf("archived_at still zero after archiving")
	}
	if since := time.Since(stamped.Time()); since < 0 || since > time.Minute {
		t.Errorf("archived_at = %v, want approximately now", stamped)
	}

	fresh, err = env.app.FindRecordById("cards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload card: %v", err)
	}
	fresh.Set("archived", false)
	if err := env.app.Save(fresh); err != nil {
		t.Fatalf("restore card: %v", err)
	}
	if got := fresh.GetDateTime("archived_at"); !got.IsZero() {
		t.Fatalf("archived_at = %v after restoring, want zero", got)
	}
}

// An update that does not flip `archived` must neither mint nor erase the
// stamp, whatever the body carries — no rule can pin a scalar field.
func TestCardArchivedAt_UnchangedFlagCannotForgeOrErase(t *testing.T) {
	env := setupCardsEnv(t)
	registerCardArchivedAt(env.app)

	// Forge on a live card: a title edit carrying a stamp.
	fresh, err := env.app.FindRecordById("cards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload card: %v", err)
	}
	fresh.Set("title", "renamed")
	fresh.Set("archived_at", types.NowDateTime())
	if err := env.app.Save(fresh); err != nil {
		t.Fatalf("save with forged archived_at: %v", err)
	}
	if got := fresh.GetDateTime("archived_at"); !got.IsZero() {
		t.Fatalf("archived_at = %v on a live card after a title edit, want zero (forged stamp survived)", got)
	}

	// Erase on an archived card: archive for real, then an unrelated update
	// carrying ''.
	fresh, err = env.app.FindRecordById("cards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload card: %v", err)
	}
	fresh.Set("archived", true)
	if err := env.app.Save(fresh); err != nil {
		t.Fatalf("archive card: %v", err)
	}
	want := fresh.GetDateTime("archived_at")
	if want.IsZero() {
		t.Fatalf("archived_at zero after archiving")
	}

	fresh, err = env.app.FindRecordById("cards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload card: %v", err)
	}
	fresh.Set("title", "renamed again")
	fresh.Set("archived_at", "")
	if err := env.app.Save(fresh); err != nil {
		t.Fatalf("save with cleared archived_at: %v", err)
	}
	if got := fresh.GetDateTime("archived_at"); got.IsZero() {
		t.Fatalf("archived_at erased by an unrelated update, want %v kept", want)
	}
}
