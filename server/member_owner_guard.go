package cards

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Surfaced verbatim in the Share dialog's error banner — write it for humans.
const lastProjectOwnerMessage = "this is the board's last owner — make another member an owner first"

// hasOtherProjectOwner reports whether the project has an owner row besides
// excludeRowID. The row about to change is excluded so it cannot keep itself
// alive.
func hasOtherProjectOwner(app core.App, projectID, excludeRowID string) (bool, error) {
	n, err := app.CountRecords("cards_project_members",
		dbx.HashExp{"project": projectID, "role": "owner"},
		dbx.Not(dbx.HashExp{"id": excludeRowID}),
	)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// registerMemberLastOwnerGuard rejects API writes that would leave a board
// with zero owners: demoting the last owner row or deleting it (which covers
// both an owner removing themselves and an owner self-leave).
//
// This is the ONE authorization decision a PB rule cannot express — a rule
// evaluates against a single row and cannot count the remaining owners — so
// the migration ships no protection and an owner could orphan their own board
// (ownerCanAdd requires an owner row; bootstrapFirstOwner only fires on a
// MEMBERLESS project, so nobody could ever become owner again). Mail shipped
// the dialog-only version of this guard and its last owner could still
// self-demote via the API; see mail/server/mailbox_owner_guard.go.
//
// The Share dialog's memberRowActionsFor derivation hides these actions in the
// UI; this hook refuses them at the API, where a client that ignores the UI
// still lands. Neither replaces the other — the dialog cannot bind a caller who
// never loads it, and this hook cannot explain itself in a form. Both run in
// every composition: the generated registrar is handed to the hosted-tenant and
// single-org paths alike (see register.go's note correcting the older
// "a tenant runs no feature Go" claim).
func registerMemberLastOwnerGuard(app core.App) {
	app.OnRecordUpdateRequest("cards_project_members").BindFunc(func(e *core.RecordRequestEvent) error {
		original := e.Record.Original()
		if original.GetString("role") != "owner" || e.Record.GetString("role") == "owner" {
			return e.Next()
		}
		// Operators can repair any state from the superuser console.
		if e.Auth != nil && e.Auth.IsSuperuser() {
			return e.Next()
		}
		other, err := hasOtherProjectOwner(e.App, original.GetString("project"), e.Record.Id)
		if err != nil {
			return e.InternalServerError("last-owner check failed", err)
		}
		if !other {
			return e.ForbiddenError(lastProjectOwnerMessage, nil)
		}
		return e.Next()
	})

	app.OnRecordDeleteRequest("cards_project_members").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.Record.GetString("role") != "owner" {
			return e.Next()
		}
		if e.Auth != nil && e.Auth.IsSuperuser() {
			return e.Next()
		}
		other, err := hasOtherProjectOwner(e.App, e.Record.GetString("project"), e.Record.Id)
		if err != nil {
			return e.InternalServerError("last-owner check failed", err)
		}
		if !other {
			return e.ForbiddenError(lastProjectOwnerMessage, nil)
		}
		return e.Next()
	})
}
