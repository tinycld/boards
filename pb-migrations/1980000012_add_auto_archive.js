/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// Auto-archive: the two columns server/auto_archive.go reads.
//
// boards_projects.auto_archive_days — a per-board setting: how many days a
// card may sit in a done or canceled list before the server archives it. 0
// (PocketBase's reading of an omitted number) means never, so a board that
// predates the column behaves as it did. Owner-only for free: the project
// update rule is viaOwner.
//
// boards_cards.list_changed_at — when the card entered its current list, the
// clock the sweep counts from. SERVER-OWNED the way archived_at (1980000007)
// is: server/list_changed_at.go stamps it on create and on every list change
// and restores the stored value on every other update, so a client can
// neither age a card into the sweep nor keep one out of it.
//
// Backfilled from `updated` rather than from boards_activity's `moved` rows:
// the activity table only exists since 1980000008, so a MAX(created) with a
// fallback to `created` could date a card EARLIER than it really entered its
// list and archive it on the first sweep. `updated` is never earlier than
// the true entry, so the error is in the safe direction — later, never
// sooner.
migrate(
    app => {
        const cards = app.findCollectionByNameOrId('boards_cards')
        cards.fields.addAt(
            cards.fields.length,
            new Field({
                id: 'boards_cards_list_changed_at',
                name: 'list_changed_at',
                type: 'date',
                required: false,
            })
        )
        app.save(cards)
        app.db()
            .newQuery("UPDATE boards_cards SET list_changed_at = updated WHERE list_changed_at = ''")
            .execute()

        const projects = app.findCollectionByNameOrId('boards_projects')
        projects.fields.addAt(
            projects.fields.length,
            new Field({
                id: 'boards_projects_auto_archive_days',
                name: 'auto_archive_days',
                type: 'number',
                required: false,
                min: 0,
                max: 365,
                onlyInt: true,
            })
        )
        app.save(projects)
    },
    app => {
        const projects = app.findCollectionByNameOrId('boards_projects')
        projects.fields.removeById('boards_projects_auto_archive_days')
        app.save(projects)
        const cards = app.findCollectionByNameOrId('boards_cards')
        cards.fields.removeById('boards_cards_list_changed_at')
        app.save(cards)
    }
)
