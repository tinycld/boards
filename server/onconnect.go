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
// isReadOnly resolves whether this connection may write to the board's
// document, by looking up the member's role.
//
// Any doubt resolves to read-only: a membership lookup that failed is not
// evidence of permission. That conservative answer is only safe because it is
// RECHECKABLE — see boardWritePredicate, which re-resolves rather than trusting
// a cached "no" for the life of the connection.
func isReadOnly(app core.App, projectID, authID string) bool {
	if authID == "" {
		return true
	}
	records, err := app.FindRecordsByFilter(
		"cards_project_members",
		"project = {:project} && user = {:user}",
		"", 1, 0,
		dbx.Params{"project": projectID, "user": authID},
	)
	if err != nil || len(records) != 1 {
		return true
	}
	role := records[0].GetString("role")
	return role != "owner" && role != "editor"
}

// boardWritePredicate gates every inbound document update.
//
// A cached `false` (may write) is taken at face value — permission is never
// revoked mid-connection by this path, and re-querying per frame would put a
// database round-trip in the hot route path.
//
// A cached `true` is RE-RESOLVED, and that is the whole point. Creating a board
// writes the project row and the owner's membership row as two separate
// statements, and the client navigates to the new board — opening this socket —
// as soon as the first one lands. A connection that arrived in that window found
// no membership row and cached "read-only" FOREVER, silently dropping every
// keystroke of every description typed on that connection. The client had no
// idea: its own Y.Doc kept the text, so the description looked saved right up
// until it was read back from the server and came back empty.
//
// Re-resolving costs a query only on a connection that currently believes it
// cannot write — which for a member who can write means once, on the first
// update after the row appears, after which the cache is corrected and the hot
// path is a field read again.
func boardWritePredicate(app core.App) func(*realtime.Client, string) bool {
	return func(c *realtime.Client, projectID string) bool {
		if !c.ReadOnly() {
			return true
		}
		if isReadOnly(app, projectID, c.AuthID()) {
			return false
		}
		// The row exists now; stop paying for the lookup.
		c.SetReadOnly(false)
		return true
	}
}

func makeOnConnect(app core.App, state *boardDocState) realtime.ServerHelloFn {
	return func(projectID string, c *realtime.Client) ([]byte, error) {
		readOnly := isReadOnly(app, projectID, c.AuthID())
		c.SetReadOnly(readOnly)

		return json.Marshal(boardHello{
			ReadOnly: readOnly,
			DocEpoch: state.epochOf(projectID),
		})
	}
}
