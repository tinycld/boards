/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// Two columns that answer the same question from opposite ends: is this column
// healthy? A WIP limit catches a column holding too many cards; the aging
// threshold catches a card that has stopped moving.
//
// Appended rather than edited into an earlier migration, for the reason
// 1980000005 gives: an applied migration never re-runs, so an in-place edit
// silently never reaches a database that already has it.
//
// boards_lists.wip_limit — how many cards belong in this column at once.
//
// A NUMBER, not a select: unlike `category` (1980000011) there is no fixed
// vocabulary here. A limit is whatever a team's flow can carry, and the value
// people actually pick is a small integer with no natural ladder — the max is
// a sanity bound, not a scale.
//
// required: FALSE, and ZERO MEANS NO LIMIT. PocketBase reads an omitted number
// back as 0, so an unlimited column and a column that predates this migration
// are the same row, which is why there is no backfill below. The boundary
// normalizes 0 away to `undefined` (lib/wip.ts), exactly as `estimate`
// (1980000010) does, so "no limit" has one representation on each side of the
// wire.
//
// NOTHING ENFORCES IT. The limit colours the column header and nothing else:
// no rule, no hook, no endpoint refuses a write. That is deliberate and is the
// whole reason this migration adds no rule change. A client-side block would
// make the UI refuse what the REST API and the CLI allow, and a server guard
// would fail bulk moves, the Trello importer, cross-board moves and the
// automation actions PARTWAY THROUGH — a half-applied batch is worse than an
// over-full column. Trello and Jira both warn rather than block for the same
// reason.
//
// boards_projects.aging_days — how long a card may sit in one column before
// its face is tinted. 0 means never, so a board that predates the column looks
// exactly as it did.
//
// The clock it counts from is boards_cards.list_changed_at (1980000012), NOT
// `updated`. `updated` moves on every write — a label toggle, a comment,
// server/counters.go's recount — so a genuinely stalled card would read as
// fresh, which inverts the signal the tint exists to give. list_changed_at is
// already server-owned (server/list_changed_at.go stamps it on create and on
// every list change, and restores the stored value on every other update), so
// the aging half needs no column of its own and cannot be gamed by a client.
//
// No access rule changes. boards_lists.update is already viaWriter + pinProject
// and boards_projects.update is already viaOwner, which is the right split
// unchanged: the limit is a column property the team tunes, the threshold is a
// board policy its owner sets.
migrate(
    app => {
        const lists = app.findCollectionByNameOrId('boards_lists')
        lists.fields.addAt(
            lists.fields.length,
            new Field({
                id: 'boards_lists_wip_limit',
                name: 'wip_limit',
                type: 'number',
                required: false,
                min: 0,
                max: 999,
                onlyInt: true,
            })
        )
        app.save(lists)

        const projects = app.findCollectionByNameOrId('boards_projects')
        projects.fields.addAt(
            projects.fields.length,
            new Field({
                id: 'boards_projects_aging_days',
                name: 'aging_days',
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
        projects.fields.removeById('boards_projects_aging_days')
        app.save(projects)

        const lists = app.findCollectionByNameOrId('boards_lists')
        lists.fields.removeById('boards_lists_wip_limit')
        app.save(lists)
    }
)
