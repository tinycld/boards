/// <reference path="../../tinycld/server/pb_data/types.d.ts" />

// Per-link download counters, so a shared board's attachments can be metered
// the same way a shared drive file is.
//
// Three fields where drive needs two: drive's download_count shipped back in
// its 1716400000, and boards never had one — an attachment is served by
// PocketBase's own file route under the share-token read rule, with no Go
// handler anywhere to count in. The meter that now runs on that route needs
// somewhere to keep the tally.
//
// The names and the semantics are deliberately IDENTICAL to drive's
// 1782200000. Both packages meter through one core seam against one pair of
// ceilings, and a ceiling of 20 has to mean the same thing on both sides or
// it is not a limit. If you rename one, rename both.
//
// download_day is text ('YYYY-MM-DD') rather than a date: a date carries a
// time-of-day this value does not have, and a plain string compares for
// equality with no timezone interpretation at read time. UTC, matching
// drive's window and every timestamp these collections already write.
//
// Existing rows get NULL, which reads as 0 and as a stale day, so the first
// download after this lands starts the window cleanly. No backfill.
migrate(
    app => {
        const collection = app.findCollectionByNameOrId('boards_share_links')

        collection.fields.addAt(
            collection.fields.length,
            new Field({
                type: 'number',
                name: 'download_count',
                min: 0,
                onlyInt: true,
            })
        )

        collection.fields.addAt(
            collection.fields.length,
            new Field({
                type: 'number',
                name: 'day_download_count',
                min: 0,
                onlyInt: true,
            })
        )

        collection.fields.addAt(
            collection.fields.length,
            new Field({
                type: 'text',
                name: 'download_day',
                max: 10,
            })
        )

        return app.save(collection)
    },
    app => {
        const collection = app.findCollectionByNameOrId('boards_share_links')
        collection.fields.removeByName('download_count')
        collection.fields.removeByName('day_download_count')
        collection.fields.removeByName('download_day')
        return app.save(collection)
    }
)
