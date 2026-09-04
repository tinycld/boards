/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// cards_epics — a named grouping of cards, and `cards_cards.epic` naming one.
//
// THE SHAPE. A COLLECTION, not a column, and the contrast with 1980000015's
// `parent` is the whole design note. A sub-task is an ordinary card, so
// "parent" needed no row shape a card did not already have. An epic is not a
// card: it has no list, no position on a board, no assignees and no deadline
// of its own, and it outlives every card in it. Modelling it as a card with a
// flag would put a phantom row on the board that every query then has to
// exclude.
//
// SAME BOARD, like `parent` and unlike cards_card_links (1980000016). A link
// crosses boards because "blocks" is a real relationship between separate
// work; an epic is a unit of scope ON a board, and its rollup renders beside
// the board's own cards. Cross-board epics would put the two-project rule
// design of 1980000016 onto a row that gains nothing from it. Pinned below on
// both create and update, and asserted literally in shipped_rules_test.go.
//
// cascadeDelete: false on `epic`, the 1980000015 asymmetry and for the same
// reason: deleting an epic must ORPHAN its cards, never destroy them. Nine
// cards are real work someone did, and losing them to a tidy-up of their
// container is unrecoverable. The cards are promoted to no-epic instead (the
// column reads as a dangling id, which the client treats as unset exactly as
// it already does for a deleted parent).
//
// THE ROLLUP IS POINTS, NOT COUNTS, and an unestimated card is worth 1.
//
// The alternative — counting cards — throws away the sizing a board already
// did, and a points-only rollup that treated unestimated as 0 would read
// "0 pts" on the many boards that never estimate. Defaulting an unestimated
// card to 1 point makes one number correct on both kinds of board, so there
// is no display branch and no user preference to set.
//
// The floor is applied in lib/estimate.ts's sumEstimates as well, so the
// column header and the epic agree about the same cards. That is a CHANGE to
// the shipped column total (an unestimated column read "0 pts" before this
// and reads its card count now), taken deliberately: a column holding eight
// unestimated cards is not worth zero, and two surfaces disagreeing about one
// set of cards is the worse outcome. The `estimated` / `unestimated` FILTER is
// untouched — "did someone size this card" is still a real question, and it
// is a different question from "what is it worth".
//
// `points_done` counts cards whose LIST is done or canceled, reusing the
// closed-status vocabulary from 1980000011 exactly as `subtask_done` does, so
// an epic's progress agrees with the list header glyph.
//
// Both counters are maintained by server/epic_rollup.go under counters.go's
// doctrine — recompute never delta, never fail the user's write — AND under
// its per-container lock, which counters.go learned the hard way: the recount
// is a read-modify-write, and parallel child writes lose updates without it.
// That lock is here from the first commit rather than after the bug.
migrate(
    app => {
        const epics = new Collection({
            id: 'pbc_cards_epics_01',
            name: 'cards_epics',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'cards_epics_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cards_projects_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cards_epics_title',
                    name: 'title',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 200,
                },
                {
                    id: 'cards_epics_description',
                    name: 'description',
                    type: 'text',
                    required: false,
                    max: 5000,
                },
                // The label palette, so an epic chip and a label chip cannot
                // drift apart visually. Free text rather than a select for the
                // reason 1980000000 gives for cards_labels.color.
                {
                    id: 'cards_epics_color',
                    name: 'color',
                    type: 'text',
                    required: false,
                    max: 40,
                },
                // A fractional rank, the cards_lists convention: epics are an
                // ordered list in the sidebar, and ranks let one move without
                // renumbering its siblings. NOT unique — see cli/rank.go's
                // warning; every query orders by `position, id`.
                {
                    id: 'cards_epics_position',
                    name: 'position',
                    type: 'text',
                    required: false,
                    max: 100,
                },
                // Epics close. Archived rather than deleted, so the cards that
                // pointed at one keep a resolvable name in their history.
                {
                    id: 'cards_epics_archived',
                    name: 'archived',
                    type: 'bool',
                },
                {
                    id: 'cards_epics_points_total',
                    name: 'points_total',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'cards_epics_points_done',
                    name: 'points_done',
                    type: 'number',
                    required: false,
                    min: 0,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_cards_epics_project` ON `cards_epics` (`project`)',
            ],
        })
        app.save(epics)

        const cards = app.findCollectionByNameOrId('cards_cards')
        cards.fields.addAt(
            cards.fields.length,
            new Field({
                id: 'cards_cards_epic',
                name: 'epic',
                type: 'relation',
                required: false,
                collectionId: 'pbc_cards_epics_01',
                cascadeDelete: false,
                maxSelect: 1,
            })
        )
        // The rollup recount reads every card in one epic; without this it is
        // a table scan on every card write. Mirrors idx_cards_cards_parent.
        cards.indexes = [
            ...cards.indexes,
            'CREATE INDEX `idx_cards_cards_epic` ON `cards_cards` (`epic`)',
        ]
        app.save(cards)

        // Restated verbatim from 1980000000 — never re-read off a collection;
        // shipped_rules_test.go asserts on literal clauses.
        const enabled = '@request.auth.disabled != true'
        const viaMember = 'project.cards_project_members_via_project.user ?= @request.auth.id'
        const viaWriter =
            `${viaMember} && (project.cards_project_members_via_project.role ?= "owner"` +
            ' || project.cards_project_members_via_project.role ?= "editor")'
        const pinProject =
            '(@request.body.project:isset = false || @request.body.project = project)'

        // A share-link visitor reads epics, because a shared board renders the
        // epic chip on its cards; without this the chip resolves to nothing
        // and a public board shows cards filed under an epic it cannot name.
        // Inlined here rather than appended to 1980000003, which is frozen —
        // the cards_comment_reactions precedent (1980000013).
        const tokenMatch =
            '@collection.cards_share_links.token ?= @request.headers.x_share_token'
        const tokenLive =
            '@collection.cards_share_links.is_active ?= true' +
            ' && (@collection.cards_share_links.expires_at ?= ""' +
            ' || @collection.cards_share_links.expires_at ?> @now)'
        const viaToken =
            `(${tokenMatch} && ${tokenLive}` + ' && @collection.cards_share_links.project ?= project)'
        const readable = `(${enabled} && ${viaMember}) || ${viaToken}`

        // cards_epics itself: the cards_labels rules — a board-scoped grouping
        // row that members read and writers write — plus the token read above.
        const epicsCol = app.findCollectionByNameOrId('cards_epics')
        epicsCol.listRule = readable
        epicsCol.viewRule = readable
        epicsCol.createRule = `${enabled} && ${viaWriter}`
        epicsCol.updateRule = `${enabled} && ${viaWriter} && ${pinProject}`
        epicsCol.deleteRule = `${enabled} && ${viaWriter}`
        app.save(epicsCol)

        // The same-board invariant on the card's side, 1980000015's three
        // branches and each earns its place for the same reasons:
        //   - `:isset = false` lets an ordinary PATCH through (trap 2).
        //   - `= ""` is how an epic is CLEARED; without it, un-filing a card
        //     would have to satisfy `"".project = project`.
        //   - `.project = project` is the invariant, one hop through the named
        //     epic, reading the INCOMING body so it constrains the write.
        const pinEpicProject =
            '(@request.body.epic:isset = false || @request.body.epic = ""' +
            ' || @request.body.epic.project = project)'

        // Restated verbatim from 1980000015 rather than read off the
        // collection: these rules are append-only by hand, and re-reading
        // would silently carry forward whatever a later migration left.
        const pinParentProject =
            '(@request.body.parent:isset = false || @request.body.parent = ""' +
            ' || @request.body.parent.project = project)'

        const cardsCol = app.findCollectionByNameOrId('cards_cards')
        cardsCol.createRule =
            `${enabled} && ${viaWriter} && ${pinParentProject} && ${pinEpicProject}`
        cardsCol.updateRule =
            `${enabled} && ${viaWriter} && ${pinProject} && ${pinParentProject} && ${pinEpicProject}`
        app.save(cardsCol)

        // One kind for both directions, as 1980000015 did for `parent`:
        // `to = ""` is a clear, `from = ""` a set.
        const activity = app.findCollectionByNameOrId('cards_activity')
        const kind = activity.fields.getById('cards_activity_kind')
        kind.values = [...kind.values, 'epic']
        app.save(activity)
    },
    app => {
        const activity = app.findCollectionByNameOrId('cards_activity')
        const kind = activity.fields.getById('cards_activity_kind')
        kind.values = kind.values.filter(value => value !== 'epic')
        app.save(activity)

        // Restores 1980000015's rules verbatim — the state before this ran.
        const enabled = '@request.auth.disabled != true'
        const viaMember = 'project.cards_project_members_via_project.user ?= @request.auth.id'
        const viaWriter =
            `${viaMember} && (project.cards_project_members_via_project.role ?= "owner"` +
            ' || project.cards_project_members_via_project.role ?= "editor")'
        const pinProject =
            '(@request.body.project:isset = false || @request.body.project = project)'
        const pinParentProject =
            '(@request.body.parent:isset = false || @request.body.parent = ""' +
            ' || @request.body.parent.project = project)'

        const cardsCol = app.findCollectionByNameOrId('cards_cards')
        cardsCol.createRule = `${enabled} && ${viaWriter} && ${pinParentProject}`
        cardsCol.updateRule = `${enabled} && ${viaWriter} && ${pinProject} && ${pinParentProject}`
        cardsCol.indexes = cardsCol.indexes.filter(
            index => !index.includes('idx_cards_cards_epic')
        )
        cardsCol.fields.removeById('cards_cards_epic')
        app.save(cardsCol)

        app.delete(app.findCollectionByNameOrId('cards_epics'))
    }
)
