/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// cards_cards.archived_at — when a card was archived, for the archived-items
// panel to sort by and to show ("Archived 3 days ago").
//
// Why not `updated`. A restored card that is then edited would report the
// edit's time as its archive time, and a card archived by a rule while
// someone else corrects its title reads the same way. The moment of archiving
// is its own fact, and a fact the UI shows deserves its own column.
//
// SERVER-OWNED, like cards_comments.edited_at: server/card_archived.go stamps
// it when `archived` flips to true, clears it when it flips back, and restores
// the stored value on every other update so a client cannot forge or erase
// it. Nothing in the client writes it.
//
// required: FALSE — a date that is empty on every active card cannot be
// required, and the validator argument 1980000005 makes applies unchanged.
migrate(
    app => {
        const cards = app.findCollectionByNameOrId('cards_cards')

        cards.fields.addAt(
            cards.fields.length,
            new Field({
                id: 'cards_cards_archived_at',
                name: 'archived_at',
                type: 'date',
                required: false,
            })
        )

        app.save(cards)

        // Approximate, and said so: nothing recorded when an already-archived
        // card was archived, and `updated` is the latest write of any kind.
        // It is the best available guess for the panel's "Archived …" line
        // and is never used for anything that matters.
        app.db()
            .newQuery(
                "UPDATE cards_cards SET archived_at = updated WHERE archived = true AND archived_at = ''"
            )
            .execute()
    },
    app => {
        const cards = app.findCollectionByNameOrId('cards_cards')
        cards.fields.removeById('cards_cards_archived_at')
        app.save(cards)
    }
)
