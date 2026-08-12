/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// cards_attachments.name — a user-editable display name.
//
// PocketBase mangles a file field's stored name (`{name}_{random10}.{ext}`)
// and offers no way to change it after upload, so renaming an attachment
// needs its own column. The upload writes the picked file's original name;
// rows from before this migration leave it empty and the client falls back
// to stripping PB's suffix off the stored name, exactly as it always has.
migrate(
    app => {
        const attachments = app.findCollectionByNameOrId('cards_attachments')

        attachments.fields.addAt(
            attachments.fields.length,
            new Field({
                id: 'cards_attach_name',
                name: 'name',
                type: 'text',
                required: false,
                max: 255,
            })
        )

        app.save(attachments)
    },
    app => {
        const attachments = app.findCollectionByNameOrId('cards_attachments')
        attachments.fields.removeById('cards_attach_name')
        app.save(attachments)
    }
)
