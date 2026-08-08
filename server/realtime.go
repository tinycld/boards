package cards

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/realtime"
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
// Must match the roomKind string in hooks/useBoardPresence.ts.
const roomKindCards = "cards-board"

// registerRealtime gates presence connections at /api/realtime/cards-board/<projectID>.
//
// Authorize-only: this room carries ephemeral awareness and no shared document,
// so there is no runtime, journal, save coordinator or write predicate to wire.
// Awareness frames are not MsgDocUpdate, so nothing here needs a write gate —
// a peer can publish only their own slot, and the worst a member can do with it
// is misreport which card they are on.
func registerRealtime(app core.App) {
	realtime.RegisterRoomKind(roomKindCards, func(auth *core.Record, roomID string) error {
		if auth == nil || auth.Id == "" {
			return realtime.ErrUnauthorized
		}
		// Mirrors the collections' `viaMember` rule fragment: a membership row
		// on this project, and not disabled. Read access is the right bar —
		// anyone who can open the board may see who else has it open, and a
		// viewer wants that as much as an editor does.
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
	})
}
