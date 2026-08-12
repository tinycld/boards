package cards

import (
	"errors"
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// Per-board card numbers — the 123 in OTTER-123.
//
// EVERY INVARIANT HERE IS THE OPPOSITE OF counters.go'S, two files over. Do not
// read that file as the pattern for this one:
//
//   - MONOTONIC, never reused. A card deleted from the top of a board must not
//     hand its number to the next card created. That rules out MAX(number)+1
//     outright: deleting the card you just made is the commonest delete there
//     is, and MAX would silently re-issue its number — two cards in a board's
//     history answering to OTTER-7, and a permalink that quietly changes
//     meaning. The counter therefore lives on the PROJECT
//     (cards_projects.next_number) and only ever moves forward.
//   - MUST FAIL THE WRITE. counters.go logs and moves on because a stale badge
//     is cosmetic. A card with no number is not: it has no key, so it cannot be
//     linked, cited or looked up, and nothing later would ever repair it.
//     Refuse the insert instead.
//   - BEFORE the row lands, so the number is part of the INSERT rather than a
//     follow-up UPDATE. A second write would emit a second realtime event and
//     make every client render a numberless card for a beat.
//
// CONCURRENCY. PocketBase does NOT wrap a single-record REST create in a
// transaction: apis/record_crud.go calls form.Submit(), which reaches
// core/db.go's app.create() with no RunInTransaction anywhere on that path —
// only apis/batch.go opens one. So a SELECT-then-UPDATE here would be a real
// time-of-check window under two concurrent inserts, not a theoretical one, and
// it is exactly the path both useCreateCard and `cards card add` take.
// allocateNumber is therefore a COMPARE-AND-SWAP: one UPDATE whose WHERE clause
// carries the value the SELECT read. A racing writer's UPDATE matches zero rows
// and it retries against the new value.

// numberAllocRetries bounds the compare-and-swap loop. Contention on a single
// board is two or three writers at worst; anything past this is a bug or a
// hostile caller, and spinning forever would pin a DB connection open.
const numberAllocRetries = 10

var errNoProject = errors.New("cards: card has no project")

// allocateNumber reserves the next number on a board and returns it.
//
// The UPDATE is the allocation: it both reads and advances the counter, and its
// WHERE pins the value the SELECT saw. COALESCE/NULLIF treats a NULL or 0
// counter as 1, so a project row written before this column existed — or by a
// caller that omitted it — starts at 1 rather than 0.
func allocateNumber(app core.App, projectID string) (int, error) {
	if projectID == "" {
		return 0, errNoProject
	}

	for attempt := 0; attempt < numberAllocRetries; attempt++ {
		var current int
		err := app.DB().
			NewQuery("SELECT COALESCE(NULLIF(next_number, 0), 1) AS n FROM cards_projects WHERE id = {:id}").
			Bind(dbx.Params{"id": projectID}).
			Row(&current)
		if err != nil {
			return 0, fmt.Errorf("cards: read next_number for project %s: %w", projectID, err)
		}

		res, err := app.NonconcurrentDB().
			NewQuery(`UPDATE cards_projects SET next_number = {:next}
			          WHERE id = {:id}
			            AND COALESCE(NULLIF(next_number, 0), 1) = {:current}`).
			Bind(dbx.Params{"id": projectID, "next": current + 1, "current": current}).
			Execute()
		if err != nil {
			return 0, fmt.Errorf("cards: bump next_number for project %s: %w", projectID, err)
		}

		affected, err := res.RowsAffected()
		if err != nil {
			return 0, fmt.Errorf("cards: bump next_number rows for project %s: %w", projectID, err)
		}
		if affected == 1 {
			return current, nil
		}
		// affected == 0 means either a racing writer moved the counter — the
		// next SELECT reads the new value and this succeeds — or the project is
		// gone, which the next SELECT surfaces as an error out of the loop.
	}

	return 0, fmt.Errorf("cards: could not allocate a number on project %s after %d attempts",
		projectID, numberAllocRetries)
}

// registerCardNumbers assigns a number to every card, on create and on any
// update that moves the card to a different board.
//
// OnRecordCreate, not OnRecordCreateExecute: `number` is required, and Execute
// fires AFTER validation (core/db.go — OnModelCreate wraps validate, which
// wraps OnModelCreateExecute), so an Execute-time assignment would be rejected
// by the validator before the hook ever ran.
//
// Returning the error — rather than logging it, as counters.go does — is what
// aborts the save. See the invariants above.
func registerCardNumbers(app *pocketbase.PocketBase) {
	app.OnRecordCreate("cards_cards").BindFunc(func(e *core.RecordEvent) error {
		// A client-supplied number is IGNORED, never trusted: no access rule
		// pins this field (it is a scalar, not a relation), so a member can put
		// anything in the request body. Overwriting unconditionally is what
		// makes the column server-owned in fact and not merely by convention.
		n, err := allocateNumber(e.App, e.Record.GetString("project"))
		if err != nil {
			return err
		}
		e.Record.Set("number", n)
		return e.Next()
	})

	// Re-key on a board change. Nothing in the UI builds this today (there is
	// no move-board affordance), but the rule has to live somewhere or a card
	// that ever crosses boards keeps a number belonging to the board it left —
	// and collides with a real card on the one it joined.
	//
	// The comparison is against the STORED record, read from Original(), which
	// PocketBase fills at PostScan — i.e. when the row was loaded from the DB.
	// Every real update path (the REST handler, the CLI, a hook) fetches the
	// record before writing it, so the pre-write project is available here.
	//
	// The empty guard is load-bearing, not defensive noise. Save() does NOT
	// refresh originalData in place, so a caller that held a record from its
	// own earlier Save and mutated it without reloading arrives here with a
	// blank Original(). Treating that as "the project changed" would re-key the
	// card on every such write and burn a number per edit. An unknown prior
	// project means we cannot prove a move happened, so we do nothing — the
	// card keeps the number it already has, which is always the safe outcome.
	app.OnRecordUpdate("cards_cards").BindFunc(func(e *core.RecordEvent) error {
		next := e.Record.GetString("project")
		prior := e.Record.Original().GetString("project")
		if next == "" || prior == "" || next == prior {
			return e.Next()
		}
		n, err := allocateNumber(e.App, next)
		if err != nil {
			return err
		}
		e.Record.Set("number", n)
		return e.Next()
	})
}
