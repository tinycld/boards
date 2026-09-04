package boards

import (
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// The two halves of card_parent.go, tested apart because their postures are
// opposite: the guard REFUSES a bad write, the rollup never fails a good one.

func setupParentEnv(t *testing.T) *cardsEnv {
	t.Helper()
	env := setupCardsEnv(t)
	registerCardParentGuard(env.app)
	registerCardParentRollup(env.app)
	return env
}

// setParent saves `parent` on a card through the model hooks, returning the
// error so a refusal can be asserted on. Fresh-loads the row first: Save()
// does not refresh originalData in place, and the rollup reads Original() to
// find the family a card is leaving.
func setParent(t *testing.T, env *cardsEnv, cardID, parentID string) error {
	t.Helper()
	card, err := env.app.FindRecordById("boards_cards", cardID)
	if err != nil {
		t.Fatalf("load card: %v", err)
	}
	card.Set("parent", parentID)
	return env.app.Save(card)
}

func rollup(t *testing.T, env *cardsEnv, cardID string) (total, done int) {
	t.Helper()
	card, err := env.app.FindRecordById("boards_cards", cardID)
	if err != nil {
		t.Fatalf("load card: %v", err)
	}
	return card.GetInt("subtask_total"), card.GetInt("subtask_done")
}

// doneList is a second list marked `done`, which is what "a completed
// sub-task" means — `is_done` on the card was retired in 1980000011.
func doneList(t *testing.T, env *cardsEnv) *core.Record {
	t.Helper()
	list := cardsList(t, env.app, env.project, "Done", "a9")
	list.Set("category", "done")
	if err := env.app.Save(list); err != nil {
		t.Fatalf("mark list done: %v", err)
	}
	return list
}

// ---------------------------------------------------------------------------
// The guard — refuses, and leaves the stored value alone.
// ---------------------------------------------------------------------------

func TestCardParentGuard_RefusesSelfParent(t *testing.T) {
	env := setupParentEnv(t)

	err := setParent(t, env, env.card.Id, env.card.Id)
	if err == nil {
		t.Fatal("a card was allowed to be its own sub-task")
	}
	if !strings.Contains(err.Error(), "its own sub-task") {
		t.Fatalf("unexpected error: %v", err)
	}
	if got, _ := rollup(t, env, env.card.Id); got != 0 {
		t.Fatalf("subtask_total = %d after a refused write, want 0", got)
	}
}

// The depth cap. Accepting this would build a three-level tree, which the
// detail panel cannot render and the one-level walk cannot bound.
func TestCardParentGuard_RefusesASubtaskOfASubtask(t *testing.T) {
	env := setupParentEnv(t)
	child := cardsCard(t, env.app, env.project, env.list, "child", "a1", env.owner)
	grandchild := cardsCard(t, env.app, env.project, env.list, "grandchild", "a2", env.owner)

	if err := setParent(t, env, child.Id, env.card.Id); err != nil {
		t.Fatalf("seed the first level: %v", err)
	}
	err := setParent(t, env, grandchild.Id, child.Id)
	if err == nil {
		t.Fatal("a three-level tree was allowed")
	}
	if !strings.Contains(err.Error(), "sub-tasks of its own") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// A cycle is unreachable while the depth cap holds, so it is reached here the
// only way it can be: by planting the far edge with a raw write that skips the
// hooks, exactly as a pre-guard row or a superuser path would.
func TestCardParentGuard_RefusesALoop(t *testing.T) {
	env := setupCardsEnv(t)
	other := cardsCard(t, env.app, env.project, env.list, "other", "a1", env.owner)

	// Planted BEFORE the guard is bound, so this write is not itself refused.
	other.Set("parent", env.card.Id)
	if err := env.app.Save(other); err != nil {
		t.Fatalf("plant the edge: %v", err)
	}
	registerCardParentGuard(env.app)

	// Closing the loop: env.card would become a child of its own child.
	err := setParent(t, env, env.card.Id, other.Id)
	if err == nil {
		t.Fatal("a parent loop was allowed")
	}
	// The depth check catches this first — `other` is already a sub-task —
	// which is the cheaper refusal and the same outcome. What matters is that
	// the write is refused and the walk terminates rather than hanging.
	if !strings.Contains(err.Error(), "sub-task") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCardParentGuard_AllowsAnOrdinaryParent(t *testing.T) {
	env := setupParentEnv(t)
	child := cardsCard(t, env.app, env.project, env.list, "child", "a1", env.owner)

	if err := setParent(t, env, child.Id, env.card.Id); err != nil {
		t.Fatalf("an ordinary parent was refused: %v", err)
	}
}

// A parent id that names no row is refused — but by PocketBase's own relation
// validation, not by checkParent, which returns nil on an unloadable parent
// rather than adding a second refusal for a case the platform already covers.
//
// The distinction that matters is with a DANGLING parent: an id that WAS valid
// and whose row was later deleted. That one survives (the relation does not
// cascade — see DeletingAParentLeavesItsChildren) and reads as top level on the
// client, which is why checkParent must not treat "cannot load" as corruption.
func TestCardParentGuard_RefusesAParentThatDoesNotExist(t *testing.T) {
	env := setupParentEnv(t)

	err := setParent(t, env, env.card.Id, "nonexistent123")
	if err == nil {
		t.Fatal("a parent naming no row was accepted")
	}
}

// The dangling case, end to end: a child keeps its parent id after the parent
// is deleted, and further edits to that child still succeed. If checkParent
// refused an unloadable parent, this write would fail and the orphan would be
// uneditable — stranded by a guard meant to protect it.
func TestCardParentGuard_AnOrphanStaysEditable(t *testing.T) {
	env := setupParentEnv(t)
	child := cardsCard(t, env.app, env.project, env.list, "child", "a1", env.owner)
	if err := setParent(t, env, child.Id, env.card.Id); err != nil {
		t.Fatalf("parent: %v", err)
	}

	parent, _ := env.app.FindRecordById("boards_cards", env.card.Id)
	if err := env.app.Delete(parent); err != nil {
		t.Fatalf("delete the parent: %v", err)
	}

	orphan, err := env.app.FindRecordById("boards_cards", child.Id)
	if err != nil {
		t.Fatalf("reload the orphan: %v", err)
	}
	orphan.Set("title", "still editable")
	if err := env.app.Save(orphan); err != nil {
		t.Fatalf("an orphaned sub-task became uneditable: %v", err)
	}
}

// ---------------------------------------------------------------------------
// The rollup — recomputed, and never fatal.
// ---------------------------------------------------------------------------

func TestCardParentRollup_CountsChildrenAndClosedOnes(t *testing.T) {
	env := setupParentEnv(t)
	done := doneList(t, env)

	open1 := cardsCard(t, env.app, env.project, env.list, "open1", "a1", env.owner)
	open2 := cardsCard(t, env.app, env.project, env.list, "open2", "a2", env.owner)
	closed := cardsCard(t, env.app, env.project, done, "closed", "a3", env.owner)

	for _, child := range []*core.Record{open1, open2, closed} {
		if err := setParent(t, env, child.Id, env.card.Id); err != nil {
			t.Fatalf("parent %s: %v", child.Id, err)
		}
	}

	total, doneCount := rollup(t, env, env.card.Id)
	if total != 3 || doneCount != 1 {
		t.Fatalf("rollup = %d/%d, want 1/3", doneCount, total)
	}
}

// "Done" is the LIST's category, so moving a child into a done list completes
// it — there is no flag on the card to set.
func TestCardParentRollup_FollowsAChildIntoADoneList(t *testing.T) {
	env := setupParentEnv(t)
	done := doneList(t, env)
	child := cardsCard(t, env.app, env.project, env.list, "child", "a1", env.owner)
	if err := setParent(t, env, child.Id, env.card.Id); err != nil {
		t.Fatalf("parent: %v", err)
	}

	if _, got := rollup(t, env, env.card.Id); got != 0 {
		t.Fatalf("subtask_done = %d before the move, want 0", got)
	}

	fresh, _ := env.app.FindRecordById("boards_cards", child.Id)
	fresh.Set("list", done.Id)
	if err := env.app.Save(fresh); err != nil {
		t.Fatalf("move the child: %v", err)
	}

	total, doneCount := rollup(t, env, env.card.Id)
	if total != 1 || doneCount != 1 {
		t.Fatalf("rollup = %d/%d, want 1/1", doneCount, total)
	}
}

// The shape registerBoardCounters does not have: a re-parent has to recount
// BOTH families, and the one the card left is knowable only from Original().
func TestCardParentRollup_RecountsBothParentsOnARemove(t *testing.T) {
	env := setupParentEnv(t)
	second := cardsCard(t, env.app, env.project, env.list, "second-parent", "a1", env.owner)
	child := cardsCard(t, env.app, env.project, env.list, "child", "a2", env.owner)

	if err := setParent(t, env, child.Id, env.card.Id); err != nil {
		t.Fatalf("first parent: %v", err)
	}
	if err := setParent(t, env, child.Id, second.Id); err != nil {
		t.Fatalf("re-parent: %v", err)
	}

	if total, _ := rollup(t, env, env.card.Id); total != 0 {
		t.Fatalf("the card it LEFT still counts %d children, want 0", total)
	}
	if total, _ := rollup(t, env, second.Id); total != 1 {
		t.Fatalf("the card it JOINED counts %d children, want 1", total)
	}
}

func TestCardParentRollup_FallsWhenAChildIsDeleted(t *testing.T) {
	env := setupParentEnv(t)
	child := cardsCard(t, env.app, env.project, env.list, "child", "a1", env.owner)
	if err := setParent(t, env, child.Id, env.card.Id); err != nil {
		t.Fatalf("parent: %v", err)
	}
	if total, _ := rollup(t, env, env.card.Id); total != 1 {
		t.Fatalf("subtask_total = %d before the delete, want 1", total)
	}

	fresh, _ := env.app.FindRecordById("boards_cards", child.Id)
	if err := env.app.Delete(fresh); err != nil {
		t.Fatalf("delete the child: %v", err)
	}

	if total, _ := rollup(t, env, env.card.Id); total != 0 {
		t.Fatalf("subtask_total = %d after the delete, want 0", total)
	}
}

// Deleting a PARENT orphans its children rather than destroying them — the
// relation is deliberately cascadeDelete: false, because a sub-task is real
// work and losing five of them to a tidy-up is unrecoverable.
func TestCardParentRollup_DeletingAParentLeavesItsChildren(t *testing.T) {
	env := setupParentEnv(t)
	child := cardsCard(t, env.app, env.project, env.list, "child", "a1", env.owner)
	if err := setParent(t, env, child.Id, env.card.Id); err != nil {
		t.Fatalf("parent: %v", err)
	}

	parent, _ := env.app.FindRecordById("boards_cards", env.card.Id)
	if err := env.app.Delete(parent); err != nil {
		t.Fatalf("delete the parent: %v", err)
	}

	if _, err := env.app.FindRecordById("boards_cards", child.Id); err != nil {
		t.Fatalf("the child was destroyed with its parent: %v", err)
	}
}

// A client-supplied count is display state the server owns: the recount
// overwrites whatever the body carried, the counters.go posture.
func TestCardParentRollup_OverwritesAClientSuppliedCount(t *testing.T) {
	env := setupParentEnv(t)
	child := cardsCard(t, env.app, env.project, env.list, "child", "a1", env.owner)

	card, _ := env.app.FindRecordById("boards_cards", env.card.Id)
	card.Set("subtask_total", 99)
	card.Set("parent", "")
	if err := env.app.Save(card); err != nil {
		t.Fatalf("save with a forged count: %v", err)
	}
	// The forged value survives until something recounts — the recount is
	// driven by CHILD writes, which is what the next line supplies.
	if err := setParent(t, env, child.Id, env.card.Id); err != nil {
		t.Fatalf("parent: %v", err)
	}

	if total, _ := rollup(t, env, env.card.Id); total != 1 {
		t.Fatalf("subtask_total = %d, want the recomputed 1", total)
	}
}
