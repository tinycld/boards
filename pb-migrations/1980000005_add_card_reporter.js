/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// cards_cards.reporter — the person a question about the card goes to.
//
// Appended rather than edited into the create migration: that file is the
// fixture M2a's Go suite applies, and PocketBase never re-runs an applied
// migration, so an in-place edit would silently never reach a database that
// already has it.
//
// WHY NOT created_by. The two look redundant and are not. created_by records
// who INSERTED the row: it is written client-side on every insert path, it is
// never read by any UI, and nothing offers to change it. That immutability is
// the point — it is provenance.
//
// A reporter has to be CORRECTABLE, which is the whole reason the field
// exists. A card filed on someone's behalf, a card created by the CLI under a
// service account, and (once the mail integration lands) a card created from
// an inbound email all want a reporter that is not whoever's session happened
// to run the insert. So the two coexist and mean different things.
//
// DEFAULTING, and why there is no Go hook. The obvious design is an
// OnRecordCreate hook filling reporter with the authenticated caller when the
// body left it empty. That cannot be written: core.RecordEvent carries no
// request auth — it holds App, Context, Type and the record, and no method in
// pocketbase/core takes a *RecordEvent receiver and exposes an identity. Only
// the request-layer OnRecordCreateRequest / *core.RecordRequestEvent reaches
// e.Auth, and request hooks do not fire for server-side app.Save() (seeds,
// protocol servers, cron).
//
// It would also be redundant. Every insert path already writes created_by with
// exactly the id such a hook would recover, one line above. So the default is
// created_by: the backfill below applies it to existing rows, useCreateCard and
// the CLI write it on new ones, and toBoardCard falls back to created_by at
// render time for anything that still arrives empty.
//
// required: FALSE, for the reason 1980000004 spells out for `number`:
// `required` is evaluated by the VALIDATOR, which runs on paths where hooks are
// not bound. The *_rls_test.go suites bind none by design, so required:true
// would make every card-create in them fail with "reporter: Cannot be blank" —
// a failure pointing at the wrong thing entirely. It buys nothing on the type
// side either: the schema generator does not consult `required` for a
// maxSelect:1 relation, so this emits as `reporter: string` regardless, with ''
// as the empty state.
//
// NO CREATE-RULE PIN, and this is deliberate rather than an oversight. Sibling
// collections pin their author field (cards_comments pins author to
// @request.auth.id on create), so its absence here needs saying: a pin would
// forbid the file-on-behalf case that justifies the field. The write is already
// gated by the viaWriter clause — an owner/editor membership on the named
// project — and the value can only be a users id, so the pin would add nothing
// but a refusal.
migrate(
    app => {
        const cards = app.findCollectionByNameOrId('cards_cards')

        cards.fields.addAt(
            cards.fields.length,
            new Field({
                id: 'cards_cards_reporter',
                name: 'reporter',
                type: 'relation',
                required: false,
                collectionId: '_pb_users_auth_',
                cascadeDelete: false,
                maxSelect: 1,
            })
        )

        app.save(cards)

        // Backfill AFTER the save: the column has to physically exist before
        // SQL can write it (mail's 1830000001 establishes this ordering).
        //
        // Raw SQL rather than findRecordsByFilter + app.save: the new value is
        // a plain column copy, expressible in one statement that fires no hooks
        // and does not load every card into the JS VM. The workspace splits on
        // exactly this line — iteration is for values needing JS (a regex
        // parse, a random id), SQL for everything else.
        //
        // `created_by != ''` is REQUIRED, not defensive. created_by holds '' by
        // convention on rows written through the bootstrap path, so a blind
        // copy would propagate an empty relation and manufacture rows claiming
        // a reporter that is not a user. Those rows are meant to have no
        // reporter, and toBoardCard renders that state as absent rather than as
        // an anonymous placeholder.
        app.db()
            .newQuery(
                "UPDATE cards_cards SET reporter = created_by WHERE reporter = '' AND created_by != ''"
            )
            .execute()
    },
    app => {
        // The backfill is deliberately NOT reverted. Which rows had an empty
        // reporter before it ran is not recorded anywhere, so there is nothing
        // to restore them to — core's 1940000000_backfill_and_require_users_role
        // documents the same convention. Dropping the column discards the
        // values regardless.
        const cards = app.findCollectionByNameOrId('cards_cards')
        cards.fields.removeById('cards_cards_reporter')
        app.save(cards)
    }
)
