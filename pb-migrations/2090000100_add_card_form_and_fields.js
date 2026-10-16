/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
// A card's type is a form (core `forms` row); its custom values live in one
// JSON column; an attachment names the file field that owns it. Both card
// columns are governed by the card rules already in place (2040000001), the
// attachment column by the attachment rules — no rule changes.
migrate(
    app => {
        const forms = app.findCollectionByNameOrId('forms')
        const cards = app.findCollectionByNameOrId('boards_cards')
        cards.fields.addAt(
            cards.fields.length,
            new Field({
                id: 'boards_cards_form',
                name: 'form',
                type: 'relation',
                required: false,
                collectionId: forms.id,
                cascadeDelete: false,
                maxSelect: 1,
            })
        )
        cards.fields.addAt(
            cards.fields.length,
            new Field({ id: 'boards_cards_fields', name: 'fields', type: 'json', required: false, maxSize: 1000000 })
        )
        cards.indexes.push('CREATE INDEX idx_boards_cards_form ON boards_cards (form)')
        app.save(cards)

        const attachments = app.findCollectionByNameOrId('boards_attachments')
        attachments.fields.addAt(
            attachments.fields.length,
            new Field({ id: 'boards_attach_field', name: 'field', type: 'text', required: false, max: 120 })
        )
        app.save(attachments)
    },
    app => {
        const attachments = app.findCollectionByNameOrId('boards_attachments')
        attachments.fields.removeById('boards_attach_field')
        app.save(attachments)
        const cards = app.findCollectionByNameOrId('boards_cards')
        cards.indexes = cards.indexes.filter(i => !i.includes('idx_boards_cards_form'))
        cards.fields.removeById('boards_cards_fields')
        cards.fields.removeById('boards_cards_form')
        app.save(cards)
    }
)
