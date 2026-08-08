package cards

import (
	"encoding/json"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/realtime"
)

// boardHello is the per-connection handshake payload.
type boardHello struct {
	// ReadOnly mirrors the server's write gate so the client can render the
	// right affordance. The gate itself is WritePredicate — this is the
	// courtesy copy, not the enforcement.
	ReadOnly bool `json:"readOnly"`
	// DocEpoch identifies this incarnation of the board's document. A client
	// that reconnects with state from an older epoch must discard it: y-crdt
	// mints a fresh clientID per document, so merging across epochs duplicates
	// content rather than converging.
	DocEpoch int64 `json:"docEpoch"`
}

// makeOnConnect resolves the joining member's role and tells them what they may
// do. Roles come from cards_project_members and mirror lib/permissions.ts:
// owner and editor may write; commentor and viewer may not.
//
// Commentors are read-only HERE specifically because comments are ordinary
// PocketBase records that never travel through this room — their ability to
// comment is unaffected by the document write gate.
func makeOnConnect(app core.App, state *boardDocState) realtime.ServerHelloFn {
	return func(projectID string, c *realtime.Client) ([]byte, error) {
		readOnly := true
		if authID := c.AuthID(); authID != "" {
			records, err := app.FindRecordsByFilter(
				"cards_project_members",
				"project = {:project} && user = {:user}",
				"", 1, 0,
				dbx.Params{"project": projectID, "user": authID},
			)
			// Any doubt about the role resolves to read-only. A membership
			// lookup that failed is not evidence of permission.
			if err == nil && len(records) == 1 {
				role := records[0].GetString("role")
				readOnly = role != "owner" && role != "editor"
			}
		}
		c.SetReadOnly(readOnly)

		return json.Marshal(boardHello{
			ReadOnly: readOnly,
			DocEpoch: state.epochOf(projectID),
		})
	}
}
