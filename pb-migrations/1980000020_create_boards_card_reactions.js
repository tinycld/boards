/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// boards_card_reactions — an emoji on a card, from one person. A vote.
//
// A JUNCTION, the boards_card_watchers shape (1980000009): one row per
// (card, user, emoji), toggled by insert and delete, never edited — so there
// is no update rule at all, and a person can only ever file or remove their
// own row (`user = @request.auth.id` on create and delete).
//
// SEPARATE FROM boards_comment_reactions rather than that table with an
// optional `comment`. Making it optional would break the unique index (two
// rows differing only in a null) and both anti-desync pins, to save a
// collection that costs nothing. The two tables are the same shape and share
// the same guard, the same grouping fold and the same UI.
//
// `project` is denormalized so the rules resolve membership in one hop, the
// convention every content row here follows, with `card.project = project` as
// the anti-desync pin. THE ROW MUST THEREFORE BE RE-STAMPED WHEN A CARD MOVES
// BOARDS (server/endpoints_move_card.go): a row left naming the source board
// is unreadable to everyone on the target. boards_comment_reactions was left
// out of that loop once and shipped unreadable-after-move; this collection is
// in it from the start, and endpoints_move_card_test.go asserts it.
//
// `emoji` is TEXT and the guard in server/reaction_emoji.go refuses anything
// that is not already canonical — see 1980000013 for why that is not
// something NFC or a regex can do.
//
// Who may react: commentors and up (viaCommenter). A vote is a lightweight
// comment, and 1980000000's doctrine is that `viewer` is read-only. Who may
// READ: members, and share-link visitors — a public board already shows the
// cards, and a reaction discloses only a user id, which assignees already
// expose as an anonymous placeholder.
migrate(
    app => {
        const reactions = new Collection({
            id: 'pbc_boards_card_reactions_01',
            name: 'boards_card_reactions',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'boards_cardrx_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_boards_projects_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'boards_cardrx_card',
                    name: 'card',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_boards_cards_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'boards_cardrx_user',
                    name: 'user',
                    type: 'relation',
                    required: true,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'boards_cardrx_emoji',
                    name: 'emoji',
                    type: 'text',
                    required: true,
                    max: 32,
                },
                {
                    id: 'boards_cardrx_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_boards_card_reactions_unique` ON `boards_card_reactions` (`card`, `user`, `emoji`)',
                'CREATE INDEX `idx_boards_card_reactions_card` ON `boards_card_reactions` (`card`)',
                // The board face reads every card's reactions in ONE query
                // keyed by project, unlike the comment table which is only
                // ever read for the open card.
                'CREATE INDEX `idx_boards_card_reactions_project` ON `boards_card_reactions` (`project`)',
            ],
        })
        app.save(reactions)

        // Restated verbatim from 1980000000 and 1980000013 — never re-read off
        // a collection; shipped_rules_test.go asserts on literal clauses.
        const enabled = '@request.auth.disabled != true'
        const viaMember = 'project.boards_project_members_via_project.user ?= @request.auth.id'
        const viaCommenter =
            `${viaMember} && (project.boards_project_members_via_project.role ?= "owner"` +
            ' || project.boards_project_members_via_project.role ?= "editor"' +
            ' || project.boards_project_members_via_project.role ?= "commentor")'
        const ownRow = 'user = @request.auth.id'
        const pinCardProject = 'card.project = project'
        const tokenMatch =
            '@collection.boards_share_links.token ?= @request.headers.x_share_token'
        const tokenLive =
            '@collection.boards_share_links.is_active ?= true' +
            ' && (@collection.boards_share_links.expires_at ?= ""' +
            ' || @collection.boards_share_links.expires_at ?> @now)'
        const viaToken =
            `(${tokenMatch} && ${tokenLive}` + ' && @collection.boards_share_links.project ?= project)'
        const readable = `(${enabled} && ${viaMember}) || ${viaToken}`

        const col = app.findCollectionByNameOrId('boards_card_reactions')
        col.listRule = readable
        col.viewRule = readable
        col.createRule = `${enabled} && ${viaCommenter} && ${ownRow} && ${pinCardProject}`
        col.updateRule = null
        col.deleteRule = `${enabled} && ${ownRow}`
        app.save(col)
    },
    app => {
        app.delete(app.findCollectionByNameOrId('boards_card_reactions'))
    }
)
