/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// boards_comment_reactions — an emoji on a comment, from one person.
//
// A JUNCTION, the boards_card_watchers shape (1980000009): one row per
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
// `emoji` is TEXT, and the two things a select used to give for free are now
// explicit. The unique index compares bytes, and "❤" and "❤️" are different
// byte strings for the same heart -- Unicode NFC neither adds nor removes the
// variation selector, so normalization cannot be left to String.normalize.
// And free text with no membership check would let the API store "not an
// emoji" as a chip nobody can toggle off. Both are enforced by the hook in
// server/reaction_emoji.go against the vocabulary in
// @tinycld/core/lib/emoji/canonical-forms.ts: a value that is not already
// canonical is refused, so exactly one byte string can ever reach the index.
//
// A select is not an option here: the picker offers ~1650 emoji, each with
// five skin tones, and skin tones count as distinct reactions.
//
// Who may react: commentors and up (viaCommenter). A reaction is a
// lightweight comment, and 1980000000's doctrine is that `viewer` is
// read-only. Who may READ: members, and share-link visitors — a public board
// already shows the comments (1980000003), and a reaction discloses only a
// user id, which assignees already expose as an anonymous placeholder.
migrate(
    app => {
        const reactions = new Collection({
            id: 'pbc_boards_reactions_01',
            name: 'boards_comment_reactions',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'boards_reactions_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_boards_projects_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'boards_reactions_card',
                    name: 'card',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_boards_cards_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'boards_reactions_comment',
                    name: 'comment',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_boards_comments_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'boards_reactions_user',
                    name: 'user',
                    type: 'relation',
                    required: true,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'boards_reactions_emoji',
                    name: 'emoji',
                    type: 'text',
                    required: true,
                    // Longest sequence the picker can produce is a two-person
                    // ZWJ emoji with tones; 32 leaves room without inviting
                    // someone to store a sentence.
                    max: 32,
                },
                {
                    id: 'boards_reactions_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_boards_reactions_unique` ON `boards_comment_reactions` (`comment`, `user`, `emoji`)',
                'CREATE INDEX `idx_boards_reactions_card` ON `boards_comment_reactions` (`card`)',
                'CREATE INDEX `idx_boards_reactions_comment` ON `boards_comment_reactions` (`comment`)',
            ],
        })
        app.save(reactions)

        // Restated verbatim from 1980000000 and 1980000003 — never re-read off
        // a collection; shipped_rules_test.go asserts on literal clauses.
        const enabled = '@request.auth.disabled != true'
        const viaMember = 'project.boards_project_members_via_project.user ?= @request.auth.id'
        const viaCommenter =
            `${viaMember} && (project.boards_project_members_via_project.role ?= "owner"` +
            ' || project.boards_project_members_via_project.role ?= "editor"' +
            ' || project.boards_project_members_via_project.role ?= "commentor")'
        const ownRow = 'user = @request.auth.id'
        const pinCommentCard = 'comment.card = card'
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

        const col = app.findCollectionByNameOrId('boards_comment_reactions')
        col.listRule = readable
        col.viewRule = readable
        col.createRule = `${enabled} && ${viaCommenter} && ${ownRow} && ${pinCommentCard} && ${pinCardProject}`
        col.updateRule = null
        col.deleteRule = `${enabled} && ${ownRow}`
        app.save(col)
    },
    app => {
        app.delete(app.findCollectionByNameOrId('boards_comment_reactions'))
    }
)
