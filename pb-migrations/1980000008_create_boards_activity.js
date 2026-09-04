/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// boards_activity — the per-card history: who changed what, and when.
//
// One row per change, written ONLY by the server (server/activity.go) from the
// hooks that see the before-and-after of every card write. No client creates,
// edits or deletes a row: history a member could rewrite is not history, so
// the create/update/delete rules are absent (superuser-only), and the client
// registers the collection read-only.
//
// `from` and `to` hold RAW values — a list id, a user id, a label id, an ISO
// date, a title — not display names. Names resolve at render from the eager
// stores, so a renamed list reads correctly in old rows and a deleted label
// degrades to "a label" rather than freezing whatever it was called.
//
// `kind` is a select rather than free text so the generated type is a real
// union the renderer can switch over exhaustively. The cost is that a new
// kind is a new migration; acceptable, because only the server writes it.
//
// `actor` is optional: automation, seeds and the collaborative-description
// flush write through app.Save with no request behind them, and those rows
// render as "Automatically". cascadeDelete: false, and deliberately NOT
// registered with core's offboarding — reassigning someone's history to a
// successor would misattribute it; PocketBase clears the relation when the
// user is deleted, which renders as a former member.
//
// Readable by members AND by share-link visitors: a public board already
// shows comments and assignees (1980000003), and the history discloses
// nothing beyond the card itself. A visitor reads no `users` rows, so actors
// render as the same anonymous placeholder assignees use.
migrate(
    app => {
        const activity = new Collection({
            id: 'pbc_boards_activity_01',
            name: 'boards_activity',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'boards_activity_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_boards_projects_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'boards_activity_card',
                    name: 'card',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_boards_cards_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'boards_activity_actor',
                    name: 'actor',
                    type: 'relation',
                    required: false,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                {
                    id: 'boards_activity_kind',
                    name: 'kind',
                    type: 'select',
                    required: true,
                    maxSelect: 1,
                    values: [
                        'created',
                        'moved',
                        'moved_board',
                        'assignee_added',
                        'assignee_removed',
                        'label_added',
                        'label_removed',
                        'due',
                        'title',
                        'description',
                        'reporter',
                        'priority',
                        'archived',
                        'restored',
                        'checklist_done',
                        'attachment_added',
                    ],
                },
                {
                    id: 'boards_activity_from',
                    name: 'from',
                    type: 'text',
                    required: false,
                    max: 1000,
                },
                {
                    id: 'boards_activity_to',
                    name: 'to',
                    type: 'text',
                    required: false,
                    max: 1000,
                },
                {
                    id: 'boards_activity_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_boards_activity_card_created` ON `boards_activity` (`card`, `created`)',
                'CREATE INDEX `idx_boards_activity_project_created` ON `boards_activity` (`project`, `created`)',
            ],
        })
        app.save(activity)

        // Restated verbatim from 1980000000 and 1980000003, never re-read off
        // a collection — shipped_rules_test.go asserts on literal clauses.
        const enabled = '@request.auth.disabled != true'
        const viaMember = 'project.boards_project_members_via_project.user ?= @request.auth.id'
        const tokenMatch =
            '@collection.boards_share_links.token ?= @request.headers.x_share_token'
        const tokenLive =
            '@collection.boards_share_links.is_active ?= true' +
            ' && (@collection.boards_share_links.expires_at ?= ""' +
            ' || @collection.boards_share_links.expires_at ?> @now)'
        const viaToken =
            `(${tokenMatch} && ${tokenLive}` + ' && @collection.boards_share_links.project ?= project)'
        const readable = `(${enabled} && ${viaMember}) || ${viaToken}`

        const col = app.findCollectionByNameOrId('boards_activity')
        col.listRule = readable
        col.viewRule = readable
        col.createRule = null
        col.updateRule = null
        col.deleteRule = null
        app.save(col)
    },
    app => {
        app.delete(app.findCollectionByNameOrId('boards_activity'))
    }
)
