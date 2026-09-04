/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// cards_lists.category — what a list MEANS in the board's workflow, replacing
// the `is_done` flag from 1980000000.
//
// Five values: backlog, todo, in_progress, done, canceled. `done` is what
// `is_done` used to say; `canceled` is new and is the other way work stops —
// a card there is finished without being complete, so it gets no reminders
// and does not fire "completed" rules. `backlog` and `in_progress` exist so
// filters, glyphs and (later) reports can tell unstarted from underway
// without a naming convention.
//
// The bool is DROPPED rather than kept in sync. A derived column is a second
// source of truth kept honest only by a hook, and every path that binds no
// hooks — the *_rls_test.go suites, an old client PATCHing `is_done` on a
// `todo` list — could desync it. Every reader has to move to `category`
// anyway (a canceled list is not `is_done`), so keeping the flag would save
// nothing and add a "which wins" rule. Nothing is released, so there is no
// deployed database to carry the old column for.
//
// Appended rather than edited into the create migration, for the reason
// 1980000005 gives. `required: false`, for the reason 1980000006 gives: the
// validator runs where hooks do not, and '' normalizes to `todo` at the
// boundary (lib/list-category.ts, server/automation.go listCategory).
migrate(
    app => {
        const lists = app.findCollectionByNameOrId('cards_lists')
        lists.fields.addAt(
            lists.fields.length,
            new Field({
                id: 'cards_lists_category',
                name: 'category',
                type: 'select',
                required: false,
                maxSelect: 1,
                values: ['backlog', 'todo', 'in_progress', 'done', 'canceled'],
            })
        )
        app.save(lists)

        // Backfill AFTER the save and in SQL (the 1980000005 split), and
        // BEFORE the flag is dropped — the CASE reads it.
        app.db()
            .newQuery(
                "UPDATE cards_lists SET category = CASE WHEN is_done = 1 THEN 'done' ELSE 'todo' END WHERE category = ''"
            )
            .execute()

        lists.fields.removeById('cards_lists_is_done')
        app.save(lists)
    },
    app => {
        const lists = app.findCollectionByNameOrId('cards_lists')
        lists.fields.addAt(
            lists.fields.length,
            new Field({ id: 'cards_lists_is_done', name: 'is_done', type: 'bool' })
        )
        app.save(lists)
        app.db().newQuery("UPDATE cards_lists SET is_done = (category = 'done')").execute()
        lists.fields.removeById('cards_lists_category')
        app.save(lists)
    }
)
