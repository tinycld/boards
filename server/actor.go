package boards

import (
	"sync"

	"github.com/pocketbase/pocketbase/core"
)

// Who is behind a write.
//
// core.RecordEvent — what the model-level hooks receive — carries no request
// auth, and the vendored fork does not thread the request through Save's
// context either. Only the request-layer hooks (OnRecord*Request) see
// e.Auth. But the request handler and the model hooks act on the SAME
// *core.Record pointer (apis/record_crud.go hands form.record straight to
// SaveWithContext), so the request hook can note the actor against the
// pointer and the after-save hook can collect it. The map is keyed by
// pointer identity, never by record id: two requests for the same row in
// flight at once must not read each other's actor.
//
// Writes with no request behind them — automation (MarkEngineWrite), seeds,
// the collaborative-description flush — never pass a request hook, so
// takeActor returns "" for them and history renders them as automatic. The
// CLI writes through the REST API with a token, so it is attributed like any
// other client.
//
// Both halves are bound against core.App so the tests bind THESE functions.

var pendingActors sync.Map // *core.Record → users id

// actorCapturedCollections are the collections whose writes the history and
// notification hooks attribute.
var actorCapturedCollections = []string{
	"boards_cards",
	"boards_checklist_items",
	"boards_attachments",
	"boards_comments",
	"boards_card_watchers",
	// Creating a link is attributed; REMOVING one is not, because this list
	// only feeds create/update request hooks and there is no delete capture.
	// See registerCardLinkActivity.
	"boards_card_links",
}

func registerActorCapture(app core.App) {
	for _, name := range actorCapturedCollections {
		app.OnRecordCreateRequest(name).BindFunc(captureActor)
		app.OnRecordUpdateRequest(name).BindFunc(captureActor)
	}
}

func captureActor(e *core.RecordRequestEvent) error {
	// Users only: a superuser token is an admin session, not a member, and
	// attributing a card move to it would name nobody the board knows.
	if e.Auth != nil && e.Auth.Collection().Name == "users" {
		pendingActors.Store(e.Record, e.Auth.Id)
	}
	// The after-success hooks run INSIDE e.Next() (Save fires them before
	// returning, absent an enclosing transaction), so every reader — the
	// history hook, the notification hook — sees the entry, and it is gone
	// the moment the request is done whether the write succeeded or not.
	err := e.Next()
	pendingActors.Delete(e.Record)
	return err
}

// actorOf returns the actor noted for this record pointer, or "" when the
// write had no request behind it. A peek, not a take: several hooks read it
// for the same write.
func actorOf(rec *core.Record) string {
	if v, ok := pendingActors.Load(rec); ok {
		if id, isString := v.(string); isString {
			return id
		}
	}
	return ""
}
