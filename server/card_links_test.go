package boards

import (
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// card_links.go — the guard that fails the write, and the history it records.

func setupLinkHookEnv(t *testing.T) *linkEnv {
	t.Helper()
	env := setupLinkEnv(t)
	registerCardLinkGuard(env.app)
	registerActorCapture(env.app)
	registerCardLinkActivity(env.app)
	return env
}

// saveLink writes a link through the model hooks, returning the error so a
// refusal can be asserted on.
func saveLink(t *testing.T, env *linkEnv, source, target, linkType string) error {
	t.Helper()
	col, err := env.app.FindCollectionByNameOrId("boards_card_links")
	if err != nil {
		t.Fatalf("find boards_card_links: %v", err)
	}
	row := core.NewRecord(col)
	row.Set("source", source)
	row.Set("target", target)
	row.Set("type", linkType)
	return env.app.Save(row)
}

// --- the guard --------------------------------------------------------------

func TestCardLinkGuard_RefusesASelfLink(t *testing.T) {
	env := setupLinkHookEnv(t)

	err := saveLink(t, env, env.card.Id, env.card.Id, "blocks")
	if err == nil {
		t.Fatal("a card was allowed to link to itself")
	}
	if !strings.Contains(err.Error(), "linked to itself") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// `A blocks B` and `B blocks A` together are a contradiction, not a pair, and
// the unique index cannot see it — the two rows differ.
func TestCardLinkGuard_RefusesTheReverseBlock(t *testing.T) {
	env := setupLinkHookEnv(t)
	other := cardsCard(t, env.app, env.project, env.list, "other", "a1", env.owner)

	if err := saveLink(t, env, env.card.Id, other.Id, "blocks"); err != nil {
		t.Fatalf("seed the first direction: %v", err)
	}
	err := saveLink(t, env, other.Id, env.card.Id, "blocks")
	if err == nil {
		t.Fatal("a mutual block was allowed")
	}
	if !strings.Contains(err.Error(), "the other way round") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// `related` and `duplicates` are SYMMETRIC — the mirror says the same thing,
// not the opposite — so the reverse guard must not fire on them. Refusing
// would make the second person to notice a relationship look wrong for it.
func TestCardLinkGuard_AllowsTheReverseOfASymmetricType(t *testing.T) {
	env := setupLinkHookEnv(t)
	other := cardsCard(t, env.app, env.project, env.list, "other", "a1", env.owner)

	if err := saveLink(t, env, env.card.Id, other.Id, "related"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := saveLink(t, env, other.Id, env.card.Id, "related"); err != nil {
		t.Fatalf("the reverse of a symmetric link was refused: %v", err)
	}
}

// Blocking in one direction while relating in the other is not a
// contradiction: the guard is scoped to `blocks` on both sides.
func TestCardLinkGuard_AllowsADifferentTypeInReverse(t *testing.T) {
	env := setupLinkHookEnv(t)
	other := cardsCard(t, env.app, env.project, env.list, "other", "a1", env.owner)

	if err := saveLink(t, env, env.card.Id, other.Id, "blocks"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := saveLink(t, env, other.Id, env.card.Id, "related"); err != nil {
		t.Fatalf("a different type in reverse was refused: %v", err)
	}
}

// The unique index still does its own job: the SAME link twice is refused
// without the guard being involved.
func TestCardLinkGuard_DuplicateLinkIsRefusedByTheIndex(t *testing.T) {
	env := setupLinkHookEnv(t)
	other := cardsCard(t, env.app, env.project, env.list, "other", "a1", env.owner)

	if err := saveLink(t, env, env.card.Id, other.Id, "blocks"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := saveLink(t, env, env.card.Id, other.Id, "blocks"); err == nil {
		t.Fatal("the same link was accepted twice")
	}
}

func TestCardLinkGuard_AllowsACrossBoardLink(t *testing.T) {
	env := setupLinkHookEnv(t)

	// The guard is board-agnostic by design: crossing boards is the feature,
	// and who may do it is the rules' business, not this hook's.
	if err := saveLink(t, env, env.card.Id, env.sharedCard.Id, "blocks"); err != nil {
		t.Fatalf("a cross-board link was refused by the guard: %v", err)
	}
}

// --- activity ---------------------------------------------------------------

// One link, two history rows — one on each card. Someone reading the far
// card's history should see it became a blocker without opening the near one.
func TestCardLinkActivity_WritesOnBothCards(t *testing.T) {
	env := setupLinkHookEnv(t)
	other := cardsCard(t, env.app, env.project, env.list, "other", "a1", env.owner)

	if err := saveLink(t, env, env.card.Id, other.Id, "blocks"); err != nil {
		t.Fatalf("link: %v", err)
	}

	for _, cardID := range []string{env.card.Id, other.Id} {
		n, err := env.app.CountRecords("boards_activity",
			dbx.HashExp{"card": cardID, "kind": "link_added"})
		if err != nil {
			t.Fatalf("count activity: %v", err)
		}
		if n != 1 {
			t.Fatalf("link_added rows on %s = %d, want 1", cardID, n)
		}
	}
}

// The row carries the type and the OTHER card's id, so history renders without
// joining back to a link row that may already be gone.
func TestCardLinkActivity_CarriesTypeAndTheOtherCard(t *testing.T) {
	env := setupLinkHookEnv(t)
	other := cardsCard(t, env.app, env.project, env.list, "other", "a1", env.owner)

	if err := saveLink(t, env, env.card.Id, other.Id, "blocks"); err != nil {
		t.Fatalf("link: %v", err)
	}

	rows := activityRows(t, env.app, env.card.Id)
	row := rowOfKind(t, rows, "link_added")
	if got := row.GetString("from"); got != "blocks" {
		t.Fatalf("activity `from` = %q, want the link type", got)
	}
	if got := row.GetString("to"); got != other.Id {
		t.Fatalf("activity `to` = %q, want the other card %q", got, other.Id)
	}
}

func TestCardLinkActivity_RecordsARemoval(t *testing.T) {
	env := setupLinkHookEnv(t)
	other := cardsCard(t, env.app, env.project, env.list, "other", "a1", env.owner)
	if err := saveLink(t, env, env.card.Id, other.Id, "blocks"); err != nil {
		t.Fatalf("link: %v", err)
	}

	links, err := env.app.FindRecordsByFilter("boards_card_links",
		"source = {:card}", "", 1, 0, dbx.Params{"card": env.card.Id})
	if err != nil || len(links) != 1 {
		t.Fatalf("reload link: %v (%d rows)", err, len(links))
	}
	if err := env.app.Delete(links[0]); err != nil {
		t.Fatalf("unlink: %v", err)
	}

	for _, cardID := range []string{env.card.Id, other.Id} {
		n, err := env.app.CountRecords("boards_activity",
			dbx.HashExp{"card": cardID, "kind": "link_removed"})
		if err != nil {
			t.Fatalf("count activity: %v", err)
		}
		if n != 1 {
			t.Fatalf("link_removed rows on %s = %d, want 1", cardID, n)
		}
	}
}

// Deleting a CARD cascades its links away. History must not then try to write
// onto the card that no longer exists — and the surviving card still gets its
// row, so its history explains why the dependency vanished.
func TestCardLinkActivity_SurvivesACascadeDelete(t *testing.T) {
	env := setupLinkHookEnv(t)
	other := cardsCard(t, env.app, env.project, env.list, "other", "a1", env.owner)
	if err := saveLink(t, env, env.card.Id, other.Id, "blocks"); err != nil {
		t.Fatalf("link: %v", err)
	}

	doomed, err := env.app.FindRecordById("boards_cards", other.Id)
	if err != nil {
		t.Fatalf("load card: %v", err)
	}
	if err := env.app.Delete(doomed); err != nil {
		t.Fatalf("delete card: %v", err)
	}

	// The link is gone with the card.
	n, err := env.app.CountRecords("boards_card_links", dbx.HashExp{"target": other.Id})
	if err != nil {
		t.Fatalf("count links: %v", err)
	}
	if n != 0 {
		t.Fatalf("links pointing at the deleted card = %d, want 0", n)
	}
	// And the surviving card recorded the removal.
	rows, err := env.app.CountRecords("boards_activity",
		dbx.HashExp{"card": env.card.Id, "kind": "link_removed"})
	if err != nil {
		t.Fatalf("count activity: %v", err)
	}
	if rows != 1 {
		t.Fatalf("link_removed rows on the surviving card = %d, want 1", rows)
	}
}
