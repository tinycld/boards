/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// cards_cards.estimate — how big a card is, in points.
//
// Appended rather than edited into the create migration, for the reason
// 1980000005 gives: an applied migration never re-runs, so an in-place edit
// silently never reaches a database that already has it.
//
// A NUMBER, not a select, unlike priority (1980000006): points are summed —
// the column header shows the total of the visible cards — and a select
// cannot be added up without every reader restating what each option is
// worth. The detail picker offers a fixed preset set (lib/estimate.ts), but
// the schema stays open to any non-negative integer so a CLI or a rule can
// write a value the picker does not list.
//
// ZERO MEANS UNSET. PocketBase reads an omitted number back as 0, never null,
// so there is no third state to keep; the client normalizes 0 to undefined at
// the boundary and writes 0 to clear. `min: 0` is what makes that safe.
//
// required: FALSE, for the reason 1980000006 spells out: `required` is
// evaluated by the validator, which runs on paths where hooks are not bound,
// and required:true on a number would in any case refuse the 0 that means
// "no estimate yet".
//
// The activity kind is appended in the same file: a new history kind is a new
// migration (1980000008), and the estimate row lands the moment the column
// exists. The select is mutated in place — removing and re-adding the field
// would drop the column and every row's kind with it.
migrate(
    app => {
        const cards = app.findCollectionByNameOrId('cards_cards')
        cards.fields.addAt(
            cards.fields.length,
            new Field({
                id: 'cards_cards_estimate',
                name: 'estimate',
                type: 'number',
                required: false,
                min: 0,
                max: 1000,
                onlyInt: true,
            })
        )
        app.save(cards)

        const activity = app.findCollectionByNameOrId('cards_activity')
        const kind = activity.fields.getById('cards_activity_kind')
        kind.values = [...kind.values, 'estimate']
        app.save(activity)
    },
    app => {
        const activity = app.findCollectionByNameOrId('cards_activity')
        const kind = activity.fields.getById('cards_activity_kind')
        kind.values = kind.values.filter(value => value !== 'estimate')
        app.save(activity)

        const cards = app.findCollectionByNameOrId('cards_cards')
        cards.fields.removeById('cards_cards_estimate')
        app.save(cards)
    }
)
