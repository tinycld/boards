package cards

import (
	"log/slog"
	"math"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/realtime"
	"tinycld.org/core/yjsdoc"
)

// roomKindCards is the realtime room kind cards owns. One room per BOARD:
// roomID is a cards_projects id, and which card a peer is looking at travels in
// their awareness slot rather than in the room identity.
//
// Per-card rooms were the alternative and are worse here on every axis: they
// would open and close a WebSocket on every peek, need a cards_cards → project
// hop before the membership check below, and still give no board-level view
// without a second room. Calc reached the same conclusion — it keeps sheetId in
// the slot, not the room id.
//
// The room carries BOTH ephemeral awareness and a shared document. That works
// because a Y.Doc is a container of named types: the board's document holds one
// XmlFragment per card (`card:<id>`), and awareness rides the same socket
// discriminated by message type. Presence and every open description therefore
// cost one connection per person, not one per card.
//
// Must match the roomKind string in hooks/useBoardPresence.ts.
const roomKindCards = "cards-board"

// registerRealtime wires /api/realtime/cards-board/<projectID>.
func registerRealtime(app core.App) {
	state := newBoardDocState()

	runtime := yjsdoc.NewRuntime()
	runtime.SetBootstrap(makeBootstrap(app, state))
	runtime.StartJanitor()

	journal := realtime.NewPocketBaseJournal(app)
	saveCoordinator := realtime.NewSaveCoordinator(makeFlush(app, state))
	saveCoordinator.SetJournal(roomKindCards, journal)

	realtime.RegisterRoomKindWith(roomKindCards, realtime.RoomKindOptions{
		Authorize:              makeAuthorize(app),
		RuntimeProvider:        runtime,
		Journal:                journal,
		OnConnect:              makeOnConnect(app, state),
		UpdateContentValidator: validateUpdate,
		// Read-only members still see presence: awareness frames are routed
		// without consulting the write gate, so a viewer keeps their avatar
		// while being unable to change a word.
		//
		// Not a bare `!c.ReadOnly()`: a connection that opened before its own
		// membership row committed would cache "read-only" for good and drop
		// every edit silently. See boardWritePredicate.
		WritePredicate: boardWritePredicate(app),
		OnRoomCreate: func(projectID string, handle realtime.DocHandle, room *realtime.Room) {
			runtime.NoteRoom(projectID, room)
			saveCoordinator.OnRoomCreate(projectID, handle, room)
		},
		OnDocUpdate:    saveCoordinator.OnDocUpdate,
		OnDocUpdateSeq: saveCoordinator.NoteSeq,
		OnEmpty: func(projectID string) {
			// Order matters: the coordinator's teardown flush must land before
			// the room's tracking is dropped, or the final edits lose the
			// baselines that tell flush what changed.
			saveCoordinator.OnRoomEmpty(projectID)
			runtime.NoteRoom(projectID, nil)
			state.drop(projectID)
		},
		ForceFlush: saveCoordinator.FlushNow,
	})

	// A deleted board leaves its write-ahead log behind; nothing reads those
	// rows again, but they are dead weight in a hot collection.
	app.OnRecordAfterDeleteSuccess("cards_projects").BindFunc(func(e *core.RecordEvent) error {
		if err := journal.Truncate(roomKindCards, e.Record.Id, math.MaxInt64); err != nil {
			slog.Warn("cards: could not truncate the journal for a deleted board",
				"projectID", e.Record.Id, "err", err)
		}
		return e.Next()
	})
}

// makeAuthorize gates connections: any non-disabled member of the board may
// join. Read access is the right bar — anyone who can open the board may see
// who else has it open, and a viewer wants that as much as an editor does.
// What a member may WRITE is decided separately, per connection, by
// makeOnConnect + WritePredicate.
func makeAuthorize(app core.App) realtime.AuthorizeFn {
	return func(auth *core.Record, roomID string) error {
		if auth == nil || auth.Id == "" {
			return realtime.ErrUnauthorized
		}
		// Mirrors the collections' `viaMember` rule fragment.
		if auth.GetBool("disabled") {
			return realtime.ErrUnauthorized
		}
		n, err := app.CountRecords("cards_project_members",
			dbx.HashExp{"project": roomID, "user": auth.Id},
		)
		if err != nil {
			return err
		}
		if n == 0 {
			return realtime.ErrUnauthorized
		}
		return nil
	}
}
