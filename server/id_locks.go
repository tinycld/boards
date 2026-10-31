package boards

import (
	"sync"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/appstate"
)

// Per-id mutexes that serialize recounts of one row. Each map lives on the
// app: a row id is unique only in its app, and the map — which grows by one
// entry per row ever recounted — is freed with the app.
var (
	recountLocksKey       = appstate.NewKey[*sync.Map]("boards.recountLocks")
	prRecountLocksKey     = appstate.NewKey[*sync.Map]("boards.prRecountLocks")
	epicRecountLocksKey   = appstate.NewKey[*sync.Map]("boards.epicRecountLocks")
	sprintRecountLocksKey = appstate.NewKey[*sync.Map]("boards.sprintRecountLocks")
)

// idLock returns app's mutex for id in the map that key names.
func idLock(app core.App, key appstate.Key[*sync.Map], id string) *sync.Mutex {
	locks := key.GetOrInit(app, func() *sync.Map { return &sync.Map{} })
	m, _ := locks.LoadOrStore(id, &sync.Mutex{})
	return m.(*sync.Mutex)
}
