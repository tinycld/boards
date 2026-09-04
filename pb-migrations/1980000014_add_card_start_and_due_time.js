/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// boards_cards.start and boards_cards.due_has_time — a card that spans days,
// and a deadline that names a time.
//
// `start` is a DAY, stored exactly as `due` always has been: the picker
// writes a bare YYYY-MM-DD, PocketBase normalizes it to midnight UTC, and the
// reader rebuilds the local day from the UTC parts (lib/due-time.ts).
//
// `due_has_time` is the flag that lets `due` carry a real instant. A due DAY
// is a calendar concept — the same for every collaborator whatever their
// zone — while a due TIME is an instant: 2 PM in New York must read 8 PM in
// Paris. One column cannot say which it holds, and the two representations
// have to be read differently (the UTC-parts rebuild applied to an instant
// shifts it by the zone offset), so the flag is what selects the parser. A
// separate HH:MM text column was rejected as zone-ambiguous; an instant with
// no flag cannot tell "midnight" from "no time".
//
// Both `required: false`, for the reason 1980000006 gives. The activity kind
// `start` is appended here, as 1980000010 did for `estimate`.
migrate(
    app => {
        const cards = app.findCollectionByNameOrId('boards_cards')
        cards.fields.addAt(
            cards.fields.length,
            new Field({ id: 'boards_cards_start', name: 'start', type: 'date', required: false })
        )
        cards.fields.addAt(
            cards.fields.length,
            new Field({ id: 'boards_cards_due_has_time', name: 'due_has_time', type: 'bool' })
        )
        app.save(cards)

        const activity = app.findCollectionByNameOrId('boards_activity')
        const kind = activity.fields.getById('boards_activity_kind')
        kind.values = [...kind.values, 'start']
        app.save(activity)
    },
    app => {
        const activity = app.findCollectionByNameOrId('boards_activity')
        const kind = activity.fields.getById('boards_activity_kind')
        kind.values = kind.values.filter(value => value !== 'start')
        app.save(activity)

        const cards = app.findCollectionByNameOrId('boards_cards')
        cards.fields.removeById('boards_cards_due_has_time')
        cards.fields.removeById('boards_cards_start')
        app.save(cards)
    }
)
