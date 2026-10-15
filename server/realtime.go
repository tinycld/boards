package boards

import (
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/realtime"
	"tinycld.org/core/yjsdoc"
)

// roomKindBoards is the realtime room kind boards owns. One room per BOARD:
// roomID is a boards_projects id, and which card a peer is looking at travels in
// their awareness slot rather than in the room identity.
//
// Per-card rooms were the alternative and are worse here on every axis: they
// would open and close a WebSocket on every peek, need a boards_cards → project
// hop before the membership check below, and still give no board-level view
// without a second room. Calc reached the same conclusion — it keeps sheetId in
// the slot, not the room id.
//
// The room carries BOTH ephemeral awareness and a shared document. That works
// because a Y.Doc is a container of named types: the board's document holds one
// XmlFragment per card description (`card:<id>`) and per collaborative field
// of a card's type (`card:<id>:<md|html>:<key>`), and awareness rides the same socket
// discriminated by message type. Presence and every open description therefore
// cost one connection per person, not one per card.
//
// Must match the roomKind string in hooks/useBoardPresence.ts.
const roomKindBoards = "boards"

// registerRealtime wires /api/realtime/boards/<projectID> and returns
// the handles the cross-board move endpoint needs to flush a source room and
// seed a target one (endpoints_move_card.go).
func registerRealtime(app core.App) *boardRealtime {
	state := newBoardDocState()

	runtime := yjsdoc.NewRuntime()
	runtime.SetBootstrap(makeBootstrap(app, state))

	checkpoints := realtime.NewPocketBaseCheckpointStore(app)
	saveCoordinator := realtime.NewSaveCoordinator(makeFlush(app, state))
	saveCoordinator.SetKind(roomKindBoards)

	realtime.RegisterRoomKindWith(roomKindBoards, realtime.RoomKindOptions{
		Authorize:              makeAuthorize(app),
		RuntimeProvider:        runtime,
		Checkpoints:            checkpoints,
		Fingerprint:            makeFingerprint(app, state),
		FlushDirty:             saveCoordinator.FlushDirty,
		OnConnect:              makeOnConnect(app),
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
		OnDocUpdate: saveCoordinator.OnDocUpdate,
		OnEmpty: func(projectID string) {
			// The document is parked, not closed: the baselines stay with it
			// so a reopen's flush still knows what changed. Only the room
			// reference goes.
			saveCoordinator.OnRoomEmpty(projectID)
			runtime.NoteRoom(projectID, nil)
		},
		// The broker closes the document after it has been parked for a
		// while, or when the records changed under it; the baselines go
		// with it, and the next open re-seeds and rebuilds them.
		OnEvict:    state.drop,
		ForceFlush: saveCoordinator.FlushNow,
	})

	// A deleted board leaves nothing behind: its parked document is closed
	// and its checkpoint row removed.
	app.OnRecordAfterDeleteSuccess("boards_projects").BindFunc(func(e *core.RecordEvent) error {
		if err := realtime.DropRoom(roomKindBoards, e.Record.Id); err != nil {
			activityLog.Warn("could not drop the document of a deleted board",
				"projectID", e.Record.Id, "err", err)
		}
		return e.Next()
	})

	return &boardRealtime{state: state, runtime: runtime, flushNow: saveCoordinator.FlushNow}
}

// makeFingerprint identifies the records a board's document was seeded
// from. While the document exists (open or parked) the baselines of the
// cards still on the board say what it believes is stored, and a change made
// to the records outside the room shows up as a difference at the next open.
// With no document, the rows themselves are hashed per fragment, normalized
// the way bootstrap normalizes them, so a document seeded from these rows and
// flushed unchanged matches.
func makeFingerprint(app core.App, state *boardDocState) realtime.FingerprintFn {
	return func(projectID string) (string, error) {
		onBoard, err := boardCardIDs(app, projectID)
		if err != nil {
			return "", fmt.Errorf("cards: fingerprint of board %s: %w", projectID, err)
		}
		if fp, ok := state.fingerprint(projectID, onBoard); ok {
			return fp, nil
		}
		records, err := seedableCards(app, projectID)
		if err != nil {
			return "", fmt.Errorf("cards: fingerprint of board %s: %w", projectID, err)
		}
		cache := newFormCache(app)
		hashes := make(map[string]string, len(records))
		for _, record := range records {
			for _, seed := range cardSeeds(record, cache) {
				hashes[seed.fragment] = hashText(normalizedText(seed.format, seed.text))
			}
		}
		return fingerprintOf(hashes), nil
	}
}

// boardCardIDs lists every card on a board, whatever it holds: a card whose
// text was emptied outside the room must still count, so its baseline shows
// the change.
func boardCardIDs(app core.App, projectID string) (map[string]bool, error) {
	var ids []string
	err := app.DB().Select("id").From("boards_cards").
		Where(dbx.HashExp{"project": projectID}).
		Column(&ids)
	if err != nil {
		return nil, err
	}
	onBoard := make(map[string]bool, len(ids))
	for _, id := range ids {
		onBoard[id] = true
	}
	return onBoard, nil
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
		n, err := app.CountRecords("boards_project_members",
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
