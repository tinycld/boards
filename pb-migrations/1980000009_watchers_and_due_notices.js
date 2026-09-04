/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// boards_card_watchers — who follows a card — and the two server-owned stamps
// the due-date reminders dedup on.
//
// A JUNCTION, not a `watchers` multi-relation on boards_cards, and the reason
// is the rules: boards_cards.update is viaWriter, and a rule cannot say "this
// caller may change only the watchers array, and only by their own id". A
// viewer or commentor — exactly the people most likely to want to follow a
// card they cannot edit — could never watch anything. A junction row pins
// `user = @request.auth.id` on create and delete, the ownMemberRow idiom from
// 1980000000, so anyone who can read the board can follow a card on it.
//
// `card.project = project` on create is the anti-desync pin: the row carries
// a denormalized `project` so the membership rule resolves in one hop, and
// without the pin a member of board A could file a watcher row naming a card
// on board B (the card relation alone does not check the project).
//
// No share-token read disjunct: an anonymous visitor has no watch state, and
// a watcher list is a member roster by another name.
//
// The two stamps on boards_cards record that the "due soon" and "overdue"
// notices have been sent, so each fires ONCE per due date across restarts —
// an in-memory dedup map (calendar's reminders.go) forgets on every deploy.
// server/due_notices.go owns them: clears both whenever `due` changes and
// restores the stored values on every other update, so a client can neither
// forge a stamp (silencing a reminder) nor erase one (repeating it).
migrate(
    app => {
        const watchers = new Collection({
            id: 'pbc_boards_watchers_01',
            name: 'boards_card_watchers',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'boards_watchers_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_boards_projects_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'boards_watchers_card',
                    name: 'card',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_boards_cards_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'boards_watchers_user',
                    name: 'user',
                    type: 'relation',
                    required: true,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'boards_watchers_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_boards_watchers_unique` ON `boards_card_watchers` (`card`, `user`)',
                'CREATE INDEX `idx_boards_watchers_card` ON `boards_card_watchers` (`card`)',
                'CREATE INDEX `idx_boards_watchers_user` ON `boards_card_watchers` (`user`)',
            ],
        })
        app.save(watchers)

        // Restated verbatim from 1980000000.
        const enabled = '@request.auth.disabled != true'
        const viaMember = 'project.boards_project_members_via_project.user ?= @request.auth.id'
        const ownRow = 'user = @request.auth.id'
        const pinCardProject = 'card.project = project'

        const col = app.findCollectionByNameOrId('boards_card_watchers')
        col.listRule = `${enabled} && ${viaMember}`
        col.viewRule = `${enabled} && ${viaMember}`
        col.createRule = `${enabled} && ${viaMember} && ${ownRow} && ${pinCardProject}`
        col.updateRule = null
        col.deleteRule = `${enabled} && ${ownRow}`
        app.save(col)

        const cards = app.findCollectionByNameOrId('boards_cards')
        cards.fields.addAt(
            cards.fields.length,
            new Field({
                id: 'boards_cards_due_soon_notified_at',
                name: 'due_soon_notified_at',
                type: 'date',
                required: false,
            })
        )
        cards.fields.addAt(
            cards.fields.length,
            new Field({
                id: 'boards_cards_overdue_notified_at',
                name: 'overdue_notified_at',
                type: 'date',
                required: false,
            })
        )
        app.save(cards)
    },
    app => {
        const cards = app.findCollectionByNameOrId('boards_cards')
        cards.fields.removeById('boards_cards_due_soon_notified_at')
        cards.fields.removeById('boards_cards_overdue_notified_at')
        app.save(cards)
        app.delete(app.findCollectionByNameOrId('boards_card_watchers'))
    }
)
