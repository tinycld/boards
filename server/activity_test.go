package cards

import (
	"sort"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// cards_activity — the server-written card history. These bind
// registerActorCapture and registerCardActivity themselves, so they measure
// the shipped hooks; the RLS half lives in activity_rls_test.go.

func setupActivityEnv(t *testing.T) *cardsEnv {
	t.Helper()
	env := setupCardsEnv(t)
	registerActorCapture(env.app)
	registerCardActivity(env.app)
	return env
}

// updateCardAs drives the request-hook chain for a card update the way the
// API does, so the actor is captured (the member_owner_guard_test.go shape).
func updateCardAs(t *testing.T, app *tests.TestApp, caller *core.Record, cardID string, mutate func(*core.Record)) {
	t.Helper()
	fresh, err := app.FindRecordById("cards_cards", cardID)
	if err != nil {
		t.Fatalf("reload card: %v", err)
	}
	mutate(fresh)
	col, err := app.FindCollectionByNameOrId("cards_cards")
	if err != nil {
		t.Fatal(err)
	}
	e := &core.RecordRequestEvent{
		RequestEvent: &core.RequestEvent{Auth: caller, App: app},
		Record:       fresh,
	}
	e.Collection = col
	err = app.OnRecordUpdateRequest("cards_cards").Trigger(e, func(_ *core.RecordRequestEvent) error {
		return app.Save(fresh)
	})
	if err != nil {
		t.Fatalf("update card: %v", err)
	}
}

func activityRows(t *testing.T, app core.App, cardID string) []*core.Record {
	t.Helper()
	rows, err := app.FindRecordsByFilter("cards_activity", "card = {:card}", "created,id", 0, 0,
		dbx.Params{"card": cardID})
	if err != nil {
		t.Fatalf("list activity: %v", err)
	}
	return rows
}

func kinds(rows []*core.Record) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.GetString("kind")
	}
	return out
}

// requireKinds compares as a multiset: rows written inside one request share
// a millisecond `created`, so their relative order is not something the
// hooks promise (the UI sorts by created, then id — stable, but arbitrary).
func requireKinds(t *testing.T, rows []*core.Record, want ...string) {
	t.Helper()
	got := kinds(rows)
	sortedGot := append([]string(nil), got...)
	sortedWant := append([]string(nil), want...)
	sort.Strings(sortedGot)
	sort.Strings(sortedWant)
	if len(sortedGot) != len(sortedWant) {
		t.Fatalf("activity kinds = %v, want %v", got, want)
	}
	for i := range sortedWant {
		if sortedGot[i] != sortedWant[i] {
			t.Fatalf("activity kinds = %v, want %v", got, want)
		}
	}
}

func rowOfKind(t *testing.T, rows []*core.Record, kind string) *core.Record {
	t.Helper()
	for _, r := range rows {
		if r.GetString("kind") == kind {
			return r
		}
	}
	t.Fatalf("no %q row among %v", kind, kinds(rows))
	return nil
}

func TestActivity_MoveIsAttributedToTheCaller(t *testing.T) {
	env := setupActivityEnv(t)
	updateCardAs(t, env.app, env.editor, env.card.Id, func(r *core.Record) {
		r.Set("list", env.list2.Id)
	})
	rows := activityRows(t, env.app, env.card.Id)
	requireKinds(t, rows, "moved")
	if got := rows[0].GetString("actor"); got != env.editor.Id {
		t.Fatalf("actor = %q, want the editor %q", got, env.editor.Id)
	}
	if rows[0].GetString("from") != env.list.Id || rows[0].GetString("to") != env.list2.Id {
		t.Fatalf("moved row carries %q → %q, want %q → %q",
			rows[0].GetString("from"), rows[0].GetString("to"), env.list.Id, env.list2.Id)
	}
}

// A drag that only reorders within a column writes `position` alone, and
// that is not history — the automation trigger draws the same line.
func TestActivity_PositionOnlyUpdateWritesNothing(t *testing.T) {
	env := setupActivityEnv(t)
	updateCardAs(t, env.app, env.editor, env.card.Id, func(r *core.Record) {
		r.Set("position", "a5")
	})
	requireKinds(t, activityRows(t, env.app, env.card.Id))
}

func TestActivity_RelationDiffsWriteOneRowPerId(t *testing.T) {
	env := setupActivityEnv(t)
	label := cardsLabel(t, env.app, env.project, "Bug", "#f00")
	updateCardAs(t, env.app, env.owner, env.card.Id, func(r *core.Record) {
		r.Set("assignees", []string{env.editor.Id, env.viewer.Id})
		r.Set("labels", []string{label.Id})
	})
	updateCardAs(t, env.app, env.owner, env.card.Id, func(r *core.Record) {
		r.Set("assignees", []string{env.viewer.Id})
		r.Set("labels", []string{})
	})
	rows := activityRows(t, env.app, env.card.Id)
	requireKinds(t, rows, "assignee_added", "assignee_added", "label_added", "assignee_removed", "label_removed")
	if got := rowOfKind(t, rows, "assignee_removed").GetString("from"); got != env.editor.Id {
		t.Fatalf("assignee_removed names %q, want %q", got, env.editor.Id)
	}
}

func TestActivity_ScalarChangesAndArchiveFlip(t *testing.T) {
	env := setupActivityEnv(t)
	updateCardAs(t, env.app, env.owner, env.card.Id, func(r *core.Record) {
		r.Set("title", "renamed")
		r.Set("due", "2026-09-12 00:00:00.000Z")
		r.Set("start", "2026-09-10 00:00:00.000Z")
		r.Set("priority", "high")
		r.Set("estimate", 5)
		r.Set("archived", true)
	})
	updateCardAs(t, env.app, env.owner, env.card.Id, func(r *core.Record) {
		r.Set("archived", false)
	})
	rows := activityRows(t, env.app, env.card.Id)
	requireKinds(t, rows, "due", "start", "title", "priority", "estimate", "archived", "restored")
	if got := rowOfKind(t, rows, "title").GetString("from"); got != "seeded-card" {
		t.Fatalf("title row from = %q, want the old title", got)
	}
	if got := rowOfKind(t, rows, "estimate").GetString("to"); got != "5" {
		t.Fatalf("estimate row to = %q, want 5", got)
	}
	// Day values are written as bare days, so the renderer needs no flag.
	if got := rowOfKind(t, rows, "due").GetString("to"); got != "2026-09-12" {
		t.Fatalf("due row to = %q, want the bare day", got)
	}
	if got := rowOfKind(t, rows, "start").GetString("to"); got != "2026-09-10" {
		t.Fatalf("start row to = %q, want the bare day", got)
	}
}

// A timed deadline is written as the instant, so the row says 2:30 PM rather
// than the day alone — and flipping the flag on the same day is a change.
func TestActivity_TimedDueWritesTheInstant(t *testing.T) {
	env := setupActivityEnv(t)
	updateCardAs(t, env.app, env.owner, env.card.Id, func(r *core.Record) {
		r.Set("due", "2026-09-12 14:30:00.000Z")
		r.Set("due_has_time", true)
	})
	rows := activityRows(t, env.app, env.card.Id)
	requireKinds(t, rows, "due")
	if got := rows[0].GetString("to"); got != "2026-09-12T14:30:00Z" {
		t.Fatalf("timed due row to = %q, want the RFC 3339 instant", got)
	}
	updateCardAs(t, env.app, env.owner, env.card.Id, func(r *core.Record) {
		r.Set("due_has_time", false)
	})
	rows = activityRows(t, env.app, env.card.Id)
	requireKinds(t, rows, "due", "due")
}

func TestActivity_ClearingAnEstimateWritesAnEmptyTo(t *testing.T) {
	env := setupActivityEnv(t)
	updateCardAs(t, env.app, env.owner, env.card.Id, func(r *core.Record) {
		r.Set("estimate", 8)
	})
	updateCardAs(t, env.app, env.owner, env.card.Id, func(r *core.Record) {
		r.Set("estimate", 0)
	})
	rows := activityRows(t, env.app, env.card.Id)
	requireKinds(t, rows, "estimate", "estimate")
	// Matched by content rather than position: the two rows can share a
	// `created` millisecond, and then their order is not promised (see
	// requireKinds).
	var sawSet, sawCleared bool
	for _, row := range rows {
		from, to := row.GetString("from"), row.GetString("to")
		sawSet = sawSet || (from == "" && to == "8")
		sawCleared = sawCleared || (from == "8" && to == "")
	}
	if !sawSet || !sawCleared {
		t.Fatalf("estimate rows = %v, want one \"\"→8 and one 8→\"\"", rowsFromTo(rows))
	}
}

func rowsFromTo(rows []*core.Record) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.GetString("from") + "→" + r.GetString("to")
	}
	return out
}

func TestActivity_ChecklistCompletionAndAttachment(t *testing.T) {
	env := setupActivityEnv(t)
	item := cardsChecklistItem(t, env.app, env.project, env.card, "Ship it", "a0")
	fresh, err := env.app.FindRecordById("cards_checklist_items", item.Id)
	if err != nil {
		t.Fatal(err)
	}
	fresh.Set("is_done", true)
	if err := env.app.Save(fresh); err != nil {
		t.Fatal(err)
	}
	// Un-completing is not recorded — only reaching done is.
	fresh.Set("is_done", false)
	if err := env.app.Save(fresh); err != nil {
		t.Fatal(err)
	}
	cardsAttachment(t, env.app, env.project, env.card, env.owner, "spec.pdf")

	rows := activityRows(t, env.app, env.card.Id)
	requireKinds(t, rows, "checklist_done", "attachment_added")
	if got := rowOfKind(t, rows, "checklist_done").GetString("to"); got != "Ship it" {
		t.Fatalf("checklist row to = %q, want the item title", got)
	}
}

// A plain app.Save — automation, a seed, the description flush — has no
// request and therefore no actor.
func TestActivity_ServerWriteHasNoActor(t *testing.T) {
	env := setupActivityEnv(t)
	fresh, err := env.app.FindRecordById("cards_cards", env.card.Id)
	if err != nil {
		t.Fatal(err)
	}
	fresh.Set("list", env.list2.Id)
	if err := env.app.Save(fresh); err != nil {
		t.Fatal(err)
	}
	rows := activityRows(t, env.app, env.card.Id)
	requireKinds(t, rows, "moved")
	if got := rows[0].GetString("actor"); got != "" {
		t.Fatalf("actor = %q on a server write, want empty", got)
	}
}

// The flush saves the description every few seconds while someone types; a
// sitting is one row, not thirty.
func TestActivity_DescriptionEditsCoalesce(t *testing.T) {
	env := setupActivityEnv(t)
	for _, body := range []string{"draft one", "draft two", "draft three"} {
		updateCardAs(t, env.app, env.owner, env.card.Id, func(r *core.Record) {
			r.Set("description", body)
		})
	}
	requireKinds(t, activityRows(t, env.app, env.card.Id), "description")
}

func TestActivity_CreateWritesCreated(t *testing.T) {
	env := setupActivityEnv(t)
	card := cardsCard(t, env.app, env.project, env.list, "brand new", "a1", env.owner)
	requireKinds(t, activityRows(t, env.app, card.Id), "created")
}

// Deleting the actor must not delete the history; the relation simply clears.
func TestActivity_DeletingTheActorKeepsTheRow(t *testing.T) {
	env := setupActivityEnv(t)
	updateCardAs(t, env.app, env.editor, env.card.Id, func(r *core.Record) {
		r.Set("list", env.list2.Id)
	})
	if err := env.app.Delete(env.editor); err != nil {
		t.Fatalf("delete editor: %v", err)
	}
	rows := activityRows(t, env.app, env.card.Id)
	requireKinds(t, rows, "moved")
	if got := rows[0].GetString("actor"); got != "" {
		t.Fatalf("actor = %q after the user was deleted, want cleared", got)
	}
}

// A parent set and cleared writes one row each, both of kind `parent` — the
// self-describing convention: `to` names the new parent, and a blank `to` is
// the card leaving its family.
func TestActivity_ParentChangesAreRecorded(t *testing.T) {
	env := setupActivityEnv(t)
	child := cardsCard(t, env.app, env.project, env.list, "child", "a1", env.owner)

	updateCardAs(t, env.app, env.editor, child.Id, func(r *core.Record) {
		r.Set("parent", env.card.Id)
	})
	// `created` comes from seeding the child itself; the parent row is the
	// one this test is about.
	rows := activityRows(t, env.app, child.Id)
	requireKinds(t, rows, "created", "parent")
	set := rowOfKind(t, rows, "parent")
	if got := set.GetString("to"); got != env.card.Id {
		t.Fatalf("parent row `to` = %q, want the parent %q", got, env.card.Id)
	}
	if got := set.GetString("actor"); got != env.editor.Id {
		t.Fatalf("actor = %q, want the editor %q", got, env.editor.Id)
	}

	updateCardAs(t, env.app, env.editor, child.Id, func(r *core.Record) {
		r.Set("parent", "")
	})
	rows = activityRows(t, env.app, child.Id)
	requireKinds(t, rows, "created", "parent", "parent")
	cleared := rows[len(rows)-1]
	if cleared.GetString("from") != env.card.Id || cleared.GetString("to") != "" {
		t.Fatalf("clear row carries %q → %q, want %q → \"\"",
			cleared.GetString("from"), cleared.GetString("to"), env.card.Id)
	}
}
