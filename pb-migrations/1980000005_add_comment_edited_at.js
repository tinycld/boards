/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// cards_comments.edited_at — the explicit "this body was revised" timestamp.
//
// The "(edited)" marker used to be INFERRED from `updated !== created`, and
// that inference destroys the information it needs at write time: PocketBase
// autodate fields are millisecond-precision, so a create and an edit landing
// on the server inside the same millisecond leave the two strings
// byte-identical and the marker can never render — permanently, however long a
// reader waits. A human cannot edit that fast, but a queued client can: an
// optimistic create followed immediately by an edit arrives at the server
// back-to-back, which is exactly how the cards e2e suite reproduced it.
//
// The column is written by server/comment_edited.go's OnRecordUpdate hook
// whenever the body actually changes — server-authoritative, so a client
// cannot revise a comment while withholding the marker. The client mutation
// also sets it optimistically so the marker renders without waiting on the
// round trip; the hook's value wins when the response lands.
//
// Backfill: rows whose autodate pair already differs were genuinely edited
// under the old inference, so they keep their marker by copying `updated`
// into the new column. Rows the old inference could never mark (the
// same-millisecond pair) stay unmarked — that information was never stored.
migrate(
    app => {
        const comments = app.findCollectionByNameOrId('cards_comments')

        comments.fields.addAt(
            comments.fields.length,
            new Field({
                id: 'cards_comments_edited_at',
                name: 'edited_at',
                type: 'date',
                required: false,
            })
        )

        app.save(comments)

        app.db()
            .newQuery(
                'UPDATE cards_comments SET edited_at = updated WHERE updated != created'
            )
            .execute()
    },
    app => {
        const comments = app.findCollectionByNameOrId('cards_comments')
        comments.fields.removeById('cards_comments_edited_at')
        app.save(comments)
    }
)
