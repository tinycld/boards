/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// cards_cards.priority — how urgent a card is, as a fixed five-step scale.
//
// Appended rather than edited into the create migration, for the reason
// 1980000005 gives: an applied migration never re-runs, so an in-place edit
// silently never reaches a database that already has it.
//
// A SELECT, not a number. A number invites "priority 7" and every client then
// has to agree on what the scale means; a select makes the vocabulary part of
// the schema, the generated type is a real union, and the automation catalog
// can render a real picker for the `set-priority` action without any client
// having to restate the options.
//
// `none` IS A VALUE, on purpose, alongside the empty string. PocketBase leaves
// an optional select as '' when a body omits it, and the client normalizes ''
// to `none` at the boundary (lib/priority.ts) — so why list it? Because an
// automation record-op has to be able to WRITE "no priority" explicitly, and
// a select param offers exactly the enum's values. Without `none` in the list
// a rule could raise a card's priority but never lower it back to nothing.
//
// required: FALSE, for the reason 1980000004 spells out for `number` and
// 1980000005 for `reporter`: `required` is evaluated by the VALIDATOR, which
// runs on paths where hooks are not bound — the *_rls_test.go suites, older
// clients, the CLI before it learned the flag. required:true would make every
// one of those card-creates fail with "priority: Cannot be blank", pointing at
// the wrong thing entirely. The backfill below and the normalizer are what
// make '' and 'none' indistinguishable to a reader.
migrate(
    app => {
        const cards = app.findCollectionByNameOrId('cards_cards')

        cards.fields.addAt(
            cards.fields.length,
            new Field({
                id: 'cards_cards_priority',
                name: 'priority',
                type: 'select',
                required: false,
                maxSelect: 1,
                values: ['urgent', 'high', 'medium', 'low', 'none'],
            })
        )

        app.save(cards)

        // Backfill AFTER the save, and in SQL rather than a record loop — the
        // same split 1980000005 documents: a plain column write needs no JS.
        app.db().newQuery("UPDATE cards_cards SET priority = 'none' WHERE priority = ''").execute()
    },
    app => {
        const cards = app.findCollectionByNameOrId('cards_cards')
        cards.fields.removeById('cards_cards_priority')
        app.save(cards)
    }
)
