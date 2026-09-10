/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// Embeddable share links: two columns that turn an existing share link into
// something a third-party page may frame.
//
// Appended rather than edited into 1980000003, for the reason 1980000005 gives:
// an applied migration never re-runs, so an in-place edit silently never
// reaches a database that already has it.
//
// NO RULE CHANGES, and that is the whole security story of this migration.
// boards_share_links stays owner-only in all five directions — a token must
// never be able to enumerate tokens (1980000003's own note). Neither column is
// ever read by the client holding the token: the browser is what enforces
// framing, and the server reads the policy when it writes the response header.
// So this widens the read surface by exactly nothing, which is what
// share_token_rls_test.go and shipped_rules_test.go should keep proving.
//
// boards_share_links.embed_domains — the origins allowed to frame this link.
//
// A space/newline separated list, stored as text rather than a JSON field
// because it is a short flat list the server parses once per request and
// never queries against.
//
// EMPTY MEANS NOT EMBEDDABLE, which is why there is no backfill below: every
// link that predates this migration reads back as "" and is refused framing,
// so the feature is opt-in for existing links and new ones alike. That
// direction is deliberate — the failure mode of the opposite default is a
// board silently becoming framable on a site its owner never named.
//
// boards_projects.visibility is NOT consulted and NOT changed. It is a display
// badge (see syncProjectVisibility's note on why it must never enter a rule),
// and embeddability is a property of one link, not of the board.
//
// boards_share_links.embed_live — whether an embed subscribes to realtime.
//
// FALSE by default, which is the opposite of what an embed gets for free. The
// share token already flows into every pbtsdb subscription
// (core/lib/pocketbase.ts's subscribeOptions getter), so a framed board would
// otherwise hold an open socket per viewer on someone else's high-traffic
// page. Making liveness the explicit choice puts that cost where its owner can
// see it.
migrate(
    app => {
        const links = app.findCollectionByNameOrId('boards_share_links')

        links.fields.addAt(
            links.fields.length,
            new Field({
                id: 'boards_share_links_embed_domains',
                name: 'embed_domains',
                type: 'text',
                required: false,
                // Sized for the handful of origins a board is realistically
                // framed at. The server caps the COUNT (sharelink.go); this is
                // only the storage bound that stops an unbounded write.
                max: 2000,
            })
        )

        links.fields.addAt(
            links.fields.length,
            new Field({
                id: 'boards_share_links_embed_live',
                name: 'embed_live',
                type: 'bool',
            })
        )

        app.save(links)
    },
    app => {
        const links = app.findCollectionByNameOrId('boards_share_links')
        links.fields.removeById('boards_share_links_embed_live')
        links.fields.removeById('boards_share_links_embed_domains')
        app.save(links)
    }
)
