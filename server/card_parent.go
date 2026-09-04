package boards

import (
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Sub-tasks: the parent rollup, and the guard that keeps the tree sane.
//
// TWO REGISTRATIONS WITH OPPOSITE POSTURES, in one file because they are one
// feature and reading them apart invites getting the postures backwards:
//
//   - registerCardParentGuard FAILS THE WRITE. A cycle or an over-deep tree is
//     corruption — it makes the rollup non-terminating and the detail panel
//     recursive — so it is refused before the row lands, the card_number.go
//     posture.
//   - registerCardParentRollup NEVER FAILS THE WRITE. The counters are display
//     state, exactly as counters.go argues: if a recount fails, the sub-task
//     the user just created still exists and the badge is stale until the next
//     event. Log and move on.
//
// The same-board invariant is NOT enforced here. It is a rule
// (pb-migrations/1980000015's pinParentProject), because a rule is what every
// caller passes through and shipped_rules_test.go can assert on its literal
// text. What is here is only what a rule genuinely cannot do: a rule sees one
// row, so it cannot walk a chain to spot a cycle or measure depth.

// maxParentDepth is 1: a card may have a parent, and a card with a parent may
// not itself be a parent.
//
// The same call lib/comment-threads.ts made for comment replies, for the same
// reason — a nested tree in a 500px side peek gives columns a few words wide,
// and a sub-task of a sub-task is a project, not a card. It also makes the
// cycle walk below trivially bounded: with one level there is no chain longer
// than two to walk.
const maxParentDepth = 1

func registerCardParentGuard(app core.App) {
	app.OnRecordCreate("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		if err := checkParent(e.App, e.Record); err != nil {
			return err
		}
		return e.Next()
	})
	app.OnRecordUpdate("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		if err := checkParent(e.App, e.Record); err != nil {
			return err
		}
		return e.Next()
	})
}

// checkParent refuses a parent that would make the tree unsound.
//
// Three refusals, in the order they are cheapest to test:
//
//   - SELF. A card is not its own sub-task. Caught explicitly rather than
//     falling out of the cycle walk, because on a CREATE the row does not
//     exist yet and the walk would not find it.
//   - DEPTH. The named parent is itself a child, so accepting this would make
//     a three-level tree.
//   - CYCLE. The named parent descends from this card. Unreachable while depth
//     holds — but depth is enforced only from here on, and a row written
//     before this guard existed (or by a superuser path that skips it) can
//     still form one, so the walk stays. It is bounded by `seen` and by
//     maxParentDepth+2 hops, so a pre-existing cycle terminates rather than
//     hanging the request.
//
// A parent that cannot be loaded is NOT refused: the rule already proved it is
// a readable card on this board, and failing a write because of a racing
// delete would be worse than leaving a dangling id — which the client already
// treats as unset, the way comment threading treats a missing parent.
func checkParent(app core.App, card *core.Record) error {
	parentID := card.GetString("parent")
	if parentID == "" {
		return nil
	}
	if parentID == card.Id {
		return fmt.Errorf("a card cannot be its own sub-task")
	}

	parent, err := app.FindRecordById("boards_cards", parentID)
	if err != nil {
		return nil
	}
	if parent.GetString("parent") != "" {
		return fmt.Errorf("a sub-task cannot have sub-tasks of its own")
	}

	seen := map[string]bool{card.Id: true, parentID: true}
	for hops, current := 0, parent; hops < maxParentDepth+2; hops++ {
		next := current.GetString("parent")
		if next == "" {
			return nil
		}
		if next == card.Id {
			return fmt.Errorf("that would make a loop of sub-tasks")
		}
		if seen[next] {
			return nil
		}
		seen[next] = true
		current, err = app.FindRecordById("boards_cards", next)
		if err != nil {
			return nil
		}
	}
	return nil
}

// registerCardParentRollup keeps subtask_total / subtask_done current.
//
// The shape registerBoardCounters does NOT have: a re-parent moves a card
// between two families, so both the card it left and the card it joined need
// recounting. Reading the old parent off Original() is the only way to know
// which card lost a child — after the save the row names only its new one.
//
// A DELETE has no Original(), so the row itself carries the parent to recount.
// Cards are not cascade-deleted by their parent (the relation is
// cascadeDelete: false, deliberately), so this fires once per card.
func registerCardParentRollup(app core.App) {
	app.OnRecordAfterCreateSuccess("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		recountParent(e.App, e.Record.GetString("parent"))
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		// Both families: the one this card left, and the one it joined. When
		// the parent did not change these are the same id and the second call
		// exits at the unchanged check.
		recountParent(e.App, e.Record.Original().GetString("parent"))
		recountParent(e.App, e.Record.GetString("parent"))
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		recountParent(e.App, e.Record.GetString("parent"))
		return e.Next()
	})
}

// recountParent recomputes one card's sub-task rollup from its children.
//
// counters.go's two invariants, restated because they are as load-bearing
// here: RECOMPUTE (never delta — a drifting badge is a bug nobody files), and
// never fail the caller's write.
//
// A missing card is not an error. Deleting a parent leaves its children
// pointing at a row that is gone, and each of those deletes lands here with
// the parent already absent — the common path, not an anomaly.
func recountParent(app core.App, parentID string) {
	if parentID == "" {
		return
	}

	parent, err := app.FindRecordById("boards_cards", parentID)
	if err != nil {
		return
	}

	total, err := countRows(app, "boards_cards", dbx.HashExp{"parent": parentID})
	if err != nil {
		app.Logger().Warn("cards: subtask recount failed", "card", parentID, "error", err)
		return
	}

	done, err := countClosedChildren(app, parentID)
	if err != nil {
		app.Logger().Warn("cards: subtask-done recount failed", "card", parentID, "error", err)
		return
	}

	// counters.go's no-op guard: every card write reaches here, and a write
	// that changes nothing still wakes every subscribed board client.
	if parent.GetInt("subtask_total") == total && parent.GetInt("subtask_done") == done {
		return
	}

	// app.Save, NOT a raw DB().Update of just these two columns.
	//
	// A targeted UPDATE was tried and reverted, and the reason is worth
	// keeping: writing through the DB layer bypasses PocketBase's realtime
	// broadcast, so the row changes on disk and NO client is told. The board
	// face then shows a stale rollup — or, for a card whose first sub-task was
	// just filed, no pill at all — until something else happens to resave the
	// card. Every Go test still passed, because they read the database
	// directly; only a browser could see it, and e2e did.
	//
	// The counters in counters.go save whole records for the same reason, and
	// they are the precedent this follows.
	parent.Set("subtask_total", total)
	parent.Set("subtask_done", done)

	if err := app.Save(parent); err != nil {
		app.Logger().Warn("cards: subtask counter save failed", "card", parentID, "error", err)
	}
}

// countClosedChildren counts the children sitting in a done or canceled list.
//
// "Done" for a sub-task is the LIST's status category, not a flag on the card
// — `is_done` was retired in 1980000011 — so "2/5" on the face agrees with the
// list header glyph a reader is looking at. The join is expressed the way
// auto_archive.go expresses the same predicate.
//
// A list whose category is ” counts as `todo` (never closed), matching
// listCategory() and lib/list-category.ts, so an unmarked list cannot silently
// mark work complete.
func countClosedChildren(app core.App, parentID string) (int, error) {
	var total int
	err := app.RecordQuery("boards_cards").
		Select("COUNT(*)").
		AndWhere(dbx.HashExp{"parent": parentID}).
		AndWhere(dbx.NewExp(
			"list IN (SELECT id FROM boards_lists WHERE category IN ('done', 'canceled'))",
		)).
		Row(&total)
	return total, err
}
