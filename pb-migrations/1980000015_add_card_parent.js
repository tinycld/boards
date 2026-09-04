/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// boards_cards.parent — sub-tasks, as cards that name another card.
//
// A sub-task is an ordinary card. It keeps its own list, position, key,
// assignees and dates, and it renders on the board like any other card; the
// only thing `parent` adds is a rollup on the parent's face and a section in
// its detail panel. That is Jira's and Linear's model, and it is what makes
// this a column rather than a collection: nothing about a sub-task needs a
// row shape a card does not already have.
//
// cascadeDelete: false, and the asymmetry with every other relation in this
// package is the point. Deleting a parent must ORPHAN its children, not
// destroy them — a sub-task is real work someone did, and losing five of them
// to a tidy-up of their parent is unrecoverable. The children are promoted to
// top level instead (`parent` reads as a dangling id, which the client treats
// as unset the way lib/comment-threads.ts already treats a missing comment
// parent). CardActionsMenu's delete confirmation says so.
//
// THE SAME-BOARD INVARIANT. `parent` may only ever name a card on the same
// board, pinned below on both create and update. Everything downstream leans
// on it: the rollup can never count a card the viewer cannot read, the Go
// recount never spans projects, and the board query (which filters by
// `project`) always holds both ends. A cross-board parent would be exactly
// the failure the anti-repoint pins exist to prevent — the card resolves on
// one board and its rollup renders on another.
//
// What the pin CANNOT do, and why there is a Go guard beside it
// (server/card_parent.go): a rule sees one row. It cannot walk a chain, so it
// cannot refuse a CYCLE (a → b → a) or enforce that the tree stays ONE LEVEL
// deep. Those are Go, and unlike the counters they fail the write — a cycle is
// corruption, not display state. Same limitation the last-owner guard has,
// recorded in 1980000000's KNOWN LIMITATIONS.
//
// `subtask_total` / `subtask_done` are the face rollup, maintained by
// server/card_parent.go under counters.go's doctrine (recompute, never delta;
// never fail the user's write). They live here rather than being counted on
// the client because a card is rendered in places the board's card set is not
// loaded — My cards, search results, the table view — and a badge that
// appears on one surface and not another reads as a bug. `subtask_done`
// counts children whose LIST is done or canceled, reusing the closed-status
// vocabulary from 1980000011, so "2/5" agrees with the list header glyph.
//
// The activity kind `parent` is appended here, as 1980000014 did for `start`.
// One kind covers both directions: `to = ""` is a clear, `from = ""` a set.
migrate(
    app => {
        const cards = app.findCollectionByNameOrId('boards_cards')
        cards.fields.addAt(
            cards.fields.length,
            new Field({
                id: 'boards_cards_parent',
                name: 'parent',
                type: 'relation',
                required: false,
                collectionId: 'pbc_boards_cards_01',
                cascadeDelete: false,
                maxSelect: 1,
            })
        )
        cards.fields.addAt(
            cards.fields.length,
            new Field({
                id: 'boards_cards_subtask_total',
                name: 'subtask_total',
                type: 'number',
                required: false,
                min: 0,
            })
        )
        cards.fields.addAt(
            cards.fields.length,
            new Field({
                id: 'boards_cards_subtask_done',
                name: 'subtask_done',
                type: 'number',
                required: false,
                min: 0,
            })
        )
        // The rollup recount reads every child of one card; without this it is
        // a table scan on every card write.
        cards.indexes = [
            ...cards.indexes,
            'CREATE INDEX `idx_boards_cards_parent` ON `boards_cards` (`parent`)',
        ]
        app.save(cards)

        // Restated verbatim from 1980000000 — never re-read off a collection;
        // shipped_rules_test.go asserts on literal clauses.
        const enabled = '@request.auth.disabled != true'
        const viaMember = 'project.boards_project_members_via_project.user ?= @request.auth.id'
        const viaWriter =
            `${viaMember} && (project.boards_project_members_via_project.role ?= "owner"` +
            ' || project.boards_project_members_via_project.role ?= "editor")'
        const pinProject =
            '(@request.body.project:isset = false || @request.body.project = project)'

        // The same-board invariant. Three branches, and each earns its place:
        //   - `:isset = false` lets an ordinary PATCH through, the reason
        //     1980000000's trap 2 gives — a client that echoes the whole
        //     record back must not be refused.
        //   - `= ""` is how a parent is CLEARED. Without it, un-parenting a
        //     card would have to satisfy `"".project = project` and could
        //     never be expressed.
        //   - `.project = project` is the invariant itself, one hop through
        //     the named card. It reads the INCOMING body's parent, so it
        //     constrains the write rather than the stored row.
        const pinParentProject =
            '(@request.body.parent:isset = false || @request.body.parent = ""' +
            ' || @request.body.parent.project = project)'

        const cardsCol = app.findCollectionByNameOrId('boards_cards')
        cardsCol.createRule = `${enabled} && ${viaWriter} && ${pinParentProject}`
        cardsCol.updateRule = `${enabled} && ${viaWriter} && ${pinProject} && ${pinParentProject}`
        app.save(cardsCol)

        const activity = app.findCollectionByNameOrId('boards_activity')
        const kind = activity.fields.getById('boards_activity_kind')
        kind.values = [...kind.values, 'parent']
        app.save(activity)
    },
    app => {
        const activity = app.findCollectionByNameOrId('boards_activity')
        const kind = activity.fields.getById('boards_activity_kind')
        kind.values = kind.values.filter(value => value !== 'parent')
        app.save(activity)

        const enabled = '@request.auth.disabled != true'
        const viaMember = 'project.boards_project_members_via_project.user ?= @request.auth.id'
        const viaWriter =
            `${viaMember} && (project.boards_project_members_via_project.role ?= "owner"` +
            ' || project.boards_project_members_via_project.role ?= "editor")'
        const pinProject =
            '(@request.body.project:isset = false || @request.body.project = project)'

        const cardsCol = app.findCollectionByNameOrId('boards_cards')
        cardsCol.createRule = `${enabled} && ${viaWriter}`
        cardsCol.updateRule = `${enabled} && ${viaWriter} && ${pinProject}`
        app.save(cardsCol)

        const cards = app.findCollectionByNameOrId('boards_cards')
        cards.indexes = cards.indexes.filter(
            index => !index.includes('idx_boards_cards_parent')
        )
        cards.fields.removeById('boards_cards_subtask_done')
        cards.fields.removeById('boards_cards_subtask_total')
        cards.fields.removeById('boards_cards_parent')
        app.save(cards)
    }
)
