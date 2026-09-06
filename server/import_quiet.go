package boards

import (
	"sync"

	"github.com/pocketbase/pocketbase/core"
)

// Suppressing the per-card hooks during a bulk import.
//
// A 500-card Trello import fires the same after-create hooks a person typing a
// card does: one activity row each, and one notification evaluation each. Both
// are right for a card someone made and wrong for a board someone poured in —
// 500 "created" rows say nothing a single "imported" does not, and the history
// they bury is the history of the work that follows.
//
// The marker is keyed by RECORD POINTER, exactly as pendingActors is
// (actor.go), and for the same reason: the request handler and the model hooks
// act on the same *core.Record, two imports may be in flight at once, and
// keying by record id would let one import silence another board's writes.
//
// Deliberately NOT automation's MarkEngineWrite. That carries rule provenance
// and a chain depth so the engine can stop a rule triggering itself; it is a
// different question with a different lifetime, and borrowing it would make an
// import look like a rule fired in every place that reads it.
//
// Auto-watch is deliberately left running. The importer owns the board they
// just created, and watching their own cards is what they would get by making
// them by hand — it costs one row per card and it is what makes the board's
// notifications work from then on.

var quietImports sync.Map // *core.Record → struct{}

// markQuietImport flags a record so the activity and notification hooks skip
// it. The caller must call the returned function once the write has landed;
// the map would otherwise pin every imported record for the process's life.
func markQuietImport(record *core.Record) func() {
	quietImports.Store(record, struct{}{})
	return func() { quietImports.Delete(record) }
}

// isQuietImport reports whether this record is part of an import that asked for
// silence.
func isQuietImport(record *core.Record) bool {
	if record == nil {
		return false
	}
	_, ok := quietImports.Load(record)
	return ok
}
