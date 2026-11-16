package boards

import (
	"sync"

	"github.com/pocketbase/pocketbase/core"
)

// How a rollup that is bound on boards_cards (an epic's points, a sprint's
// counters) follows a card write.
//
// A write with no transaction of its own (one REST save) is committed when
// the hook chain returns, and the parent is recounted then.
//
// A write inside a transaction (a sprint completion that rolls forty cards)
// is not: the parent is recounted one time, inside that transaction, before
// it commits. The counters then commit with the cards, and a transaction that
// writes N cards of one parent recounts it once, not N times.
//
// Every recount runs in a transaction (recountInTx), so the database's one
// write connection serializes them: no recount can read between another's sum
// and its save. That is what the per-id locks of counters.go are for, and why
// these two rollups need none.

// pendingRecountKey names one parent row that one transaction must recount.
type pendingRecountKey struct {
	tx   *core.TxAppInfo
	kind string
	id   string
}

var pendingRecounts sync.Map // pendingRecountKey → struct{}

// recountAfterWrite runs the card write, then recounts each parent in ids
// ("" is skipped). The caller reads the ids before the write: an update's old
// parent survives only on Original(). recount must never fail the write, so
// it returns nothing.
func recountAfterWrite(e *core.RecordEvent, kind string, recount func(app core.App, id string), ids ...string) error {
	// The app as it is before the write: a live transaction or none.
	app := e.App
	if err := e.Next(); err != nil {
		return err
	}
	info := app.TxInfo()
	for _, id := range ids {
		if id == "" {
			continue
		}
		if info == nil {
			recount(app, id)
			continue
		}
		key := pendingRecountKey{info, kind, id}
		if _, pending := pendingRecounts.LoadOrStore(key, struct{}{}); pending {
			continue
		}
		// A rollback runs no before-commit callback, so the key is dropped here.
		info.OnComplete(func(error) error {
			pendingRecounts.Delete(key)
			return nil
		})
		info.OnBeforeCommit(func(tx core.App) error {
			// Dropped first: a card write in a later callback asks again.
			pendingRecounts.Delete(key)
			recount(tx, id)
			return nil
		})
	}
	return nil
}

// recountInTx runs a recount's read-sum-save in a transaction: the caller's
// own when app is one, a new one otherwise. fn logs its own failures and
// returns nothing, so a recount never fails the write that caused it.
func recountInTx(app core.App, fn func(tx core.App)) {
	err := app.RunInTransaction(func(tx core.App) error {
		fn(tx)
		return nil
	})
	if err != nil {
		app.Logger().Warn("boards: rollup recount transaction failed", "error", err)
	}
}
