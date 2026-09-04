/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// Two additions the create migration did not anticipate, appended rather than
// edited into it: the create migration is the fixture M2a's Go suite applies,
// and PocketBase never re-runs an applied migration, so an in-place edit would
// silently never reach a database that already has it.
//
// 1. boards_cards.attachment_count — the fourth board-face counter, alongside
//    checklist_total/checklist_done/comment_count. boards_attachments syncs
//    on-demand for the same reason the other two do, so the board face cannot
//    count them at rest. M6 builds the attachment UI; the field and its
//    recount land now so M6 has no schema work left and the counter is
//    already correct for any attachment written before the UI exists.
//
// 2. A unique index on boards_labels (project, name). A board with two labels
//    both called "bug" is a UI with two indistinguishable rows and no way to
//    tell which one a card carries. Core's original mail_labels carried the
//    same constraint. Scoped to the project, so two boards may each have their
//    own "bug".
migrate(
    app => {
        const cards = app.findCollectionByNameOrId('boards_cards')

        cards.fields.addAt(
            cards.fields.length,
            new Field({
                id: 'boards_cards_attachment_count',
                name: 'attachment_count',
                type: 'number',
                required: false,
                min: 0,
            })
        )

        app.save(cards)

        const labels = app.findCollectionByNameOrId('boards_labels')

        labels.indexes = [
            ...labels.indexes,
            'CREATE UNIQUE INDEX `idx_boards_labels_project_name` ON `boards_labels` (`project`, `name`)',
        ]

        app.save(labels)
    },
    app => {
        const cards = app.findCollectionByNameOrId('boards_cards')
        cards.fields.removeById('boards_cards_attachment_count')
        app.save(cards)

        const labels = app.findCollectionByNameOrId('boards_labels')
        labels.indexes = labels.indexes.filter(
            idx => !idx.includes('idx_boards_labels_project_name')
        )
        app.save(labels)
    }
)
