package boards

import (
	"time"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/forms"
)

// attachmentsBuiltin is the card host's Attachments section. Must match its
// key in tinycld/boards/forms/hosts.ts.
const attachmentsBuiltin = "attachments"

// registerAttachmentTypeGuard refuses a plain attachment (empty `field`) on a
// card whose type hides the Attachments section. The card detail offers no way
// to add one there, but the card's face on the board accepts a dropped file
// without knowing the card's type, and the REST API reaches the collection
// directly. Only this hook sees every one of those paths.
//
// A request hook, not a model hook: the server copies attachments itself when
// a card moves boards, and those rows were accepted when they were uploaded.
// It runs after the create rule, so a caller who may not write to the card
// learns nothing about its type.
func registerAttachmentTypeGuard(app core.App) {
	app.OnRecordCreateRequest("boards_attachments").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.Record.GetString("field") != "" {
			return e.Next()
		}
		card, err := e.App.FindRecordById("boards_cards", e.Record.GetString("card"))
		if err != nil {
			return e.Next() // the create rule already requires a readable card
		}
		ctx := forms.Context{Today: time.Now().Format("2006-01-02")}
		if e.Auth != nil {
			ctx.UserID = e.Auth.Id
		}
		shown, err := newFormCache(e.App).showsField(card, attachmentsBuiltin, ctx)
		if err != nil {
			return err
		}
		if !shown {
			return e.BadRequestError("This card's type has no attachments.", nil)
		}
		return e.Next()
	})
}
