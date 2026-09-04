/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// cards_comment_reactions — an emoji on a comment, from one person.
//
// A JUNCTION, the cards_card_watchers shape (1980000009): one row per
// (comment, user, emoji), toggled by insert and delete, never edited — so
// there is no update rule at all, and a person can only ever file or remove
// their own row (`user = @request.auth.id` on create and delete).
//
// `card` is carried as well as `comment`, and that is not redundancy: the
// client reads the reactions for the OPEN card in one on-demand query
// (`reaction.card = <id>`), the only where-shape the sync layer pushes
// cheaply, rather than one query per comment. `comment.card = card` on create
// is the anti-desync pin that keeps the shortcut honest, and `card.project =
// project` is the watchers' pin one hop further out.
//
// `emoji` is a SELECT over the palette rather than free text, for the reason
// priority is (1980000006) and one more: the unique index compares bytes, and
// "❤" and "❤️" are different byte strings for the same heart. A select makes
// the palette the schema, so a variant sequence cannot slip past the index.
//
// Who may react: commentors and up (viaCommenter). A reaction is a
// lightweight comment, and 1980000000's doctrine is that `viewer` is
// read-only. Who may READ: members, and share-link visitors — a public board
// already shows the comments (1980000003), and a reaction discloses only a
// user id, which assignees already expose as an anonymous placeholder.
migrate(
    app => {
        const reactions = new Collection({
            id: 'pbc_cards_reactions_01',
            name: 'cards_comment_reactions',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'cards_reactions_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cards_projects_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cards_reactions_card',
                    name: 'card',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cards_cards_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cards_reactions_comment',
                    name: 'comment',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cards_comments_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cards_reactions_user',
                    name: 'user',
                    type: 'relation',
                    required: true,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cards_reactions_emoji',
                    name: 'emoji',
                    type: 'select',
                    required: true,
                    maxSelect: 1,
                    values: ['👍', '❤️', '😄', '🎉', '👀', '🚀'],
                },
                {
                    id: 'cards_reactions_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_cards_reactions_unique` ON `cards_comment_reactions` (`comment`, `user`, `emoji`)',
                'CREATE INDEX `idx_cards_reactions_card` ON `cards_comment_reactions` (`card`)',
                'CREATE INDEX `idx_cards_reactions_comment` ON `cards_comment_reactions` (`comment`)',
            ],
        })
        app.save(reactions)

        // Restated verbatim from 1980000000 and 1980000003 — never re-read off
        // a collection; shipped_rules_test.go asserts on literal clauses.
        const enabled = '@request.auth.disabled != true'
        const viaMember = 'project.cards_project_members_via_project.user ?= @request.auth.id'
        const viaCommenter =
            `${viaMember} && (project.cards_project_members_via_project.role ?= "owner"` +
            ' || project.cards_project_members_via_project.role ?= "editor"' +
            ' || project.cards_project_members_via_project.role ?= "commentor")'
        const ownRow = 'user = @request.auth.id'
        const pinCommentCard = 'comment.card = card'
        const pinCardProject = 'card.project = project'
        const tokenMatch =
            '@collection.cards_share_links.token ?= @request.headers.x_share_token'
        const tokenLive =
            '@collection.cards_share_links.is_active ?= true' +
            ' && (@collection.cards_share_links.expires_at ?= ""' +
            ' || @collection.cards_share_links.expires_at ?> @now)'
        const viaToken =
            `(${tokenMatch} && ${tokenLive}` + ' && @collection.cards_share_links.project ?= project)'
        const readable = `(${enabled} && ${viaMember}) || ${viaToken}`

        const col = app.findCollectionByNameOrId('cards_comment_reactions')
        col.listRule = readable
        col.viewRule = readable
        col.createRule = `${enabled} && ${viaCommenter} && ${ownRow} && ${pinCommentCard} && ${pinCardProject}`
        col.updateRule = null
        col.deleteRule = `${enabled} && ${ownRow}`
        app.save(col)
    },
    app => {
        app.delete(app.findCollectionByNameOrId('cards_comment_reactions'))
    }
)
