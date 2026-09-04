/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// boards_card_links — one card blocks, duplicates or relates to another.
//
// A JUNCTION, the boards_card_watchers shape (1980000009): one row per
// (source, target, type), filed and removed but never edited, so there is no
// update rule at all.
//
// THE THING THAT MAKES THIS COLLECTION UNLIKE EVERY OTHER ONE IN THE PACKAGE:
// a link MAY CROSS BOARDS. Every other content row names exactly one
// `project` and resolves membership through it in one hop. A link row has
// two, and the whole rule design below follows from that.
//
// NO DENORMALIZED `project` COLUMN, and the departure from the package's
// convention is deliberate. Two of them would mean two anti-repoint pins, two
// more re-stamp targets in endpoints_move_card.go, and a doubled desync
// surface on a row reachable from EITHER board. That risk is not
// hypothetical: boards_comment_reactions was left out of that endpoint's
// re-stamp loop and shipped unreadable-after-move. Resolving membership
// through `source.project` / `target.project` costs one join hop and CANNOT
// desync — the projects are read live off the cards — and it means a card
// moving to a third board carries its links correctly with no endpoint change
// at all. The three-segment path is not novel: 1986000000 already ships
// `@collection.boards_cards.project.boards_project_members_via_project`.
//
// WHY TWO RELATION PATHS DO NOT INTERFERE. PocketBase builds a join alias
// from the accumulated PATH, not the last segment
// (core/record_field_resolver_runner.go:551,:661), so
// `source.project.boards_project_members_via_project` and
// `target.project.…` produce different aliases and therefore two independent
// joins. Correlation (1980000000's trap 4) holds WITHIN each path — so
// "my membership row on the source board is an editor" lands on one row — and
// does NOT hold across them, so `||` is a genuine union and `&&` a genuine
// intersection. Both properties are needed here at once.
//
// READ IS "EITHER END", NOT "BOTH". A rule admitting only callers who can see
// both cards would hide a blocker from exactly the people it blocks — the
// failure lib/board-project.ts:109-119 already argues against for assignees:
// "a card that IS assigned would read as unassigned — misleading on a board
// where assignment is the point." The far card stays governed by
// boards_cards' own rule, so reading a link discloses the far card's ID and
// nothing else — not its title, and `expand` is no back door. The client
// renders what it cannot resolve as a redacted chip (lib/card-links.ts).
//
// WRITE IS ASYMMETRIC: writer on the source, MEMBER of the target. Writing
// the card you link FROM is a write; the card you point AT need only be one
// you can see — the split assigneeAuthorizer already makes
// (server/automation.go), where assigning needs board write but the assignee
// need only be a member.
//
// cascadeDelete: true on BOTH ends, unlike 1980000015's `parent`. A parent is
// structure worth preserving as an orphan; a link to a deleted card is a
// dangling pointer with nothing left to say.
migrate(
    app => {
        const links = new Collection({
            id: 'pbc_boards_links_01',
            name: 'boards_card_links',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'boards_links_source',
                    name: 'source',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_boards_cards_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'boards_links_target',
                    name: 'target',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_boards_cards_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                // A select rather than free text, for the reason priority is
                // one (1980000006): the generated type becomes a real union,
                // and the vocabulary cannot drift from what the UI offers.
                //
                // DIRECTIONAL, and stored once. "Blocked by" is not a fourth
                // value — it is `blocks` read from the target's end. One row
                // means one truth: a mirrored pair could disagree, and every
                // write would have to maintain both.
                {
                    id: 'boards_links_type',
                    name: 'type',
                    type: 'select',
                    required: true,
                    maxSelect: 1,
                    values: ['blocks', 'related', 'duplicates'],
                },
                {
                    id: 'boards_links_created_by',
                    name: 'created_by',
                    type: 'relation',
                    required: false,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                {
                    id: 'boards_links_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_boards_links_unique` ON `boards_card_links` (`source`, `target`, `type`)',
                // Both directions are queried: the open card reads links where
                // it is either end.
                'CREATE INDEX `idx_boards_links_source` ON `boards_card_links` (`source`)',
                'CREATE INDEX `idx_boards_links_target` ON `boards_card_links` (`target`)',
            ],
        })
        app.save(links)

        // Restated verbatim from 1980000000 and 1980000003 — never re-read off
        // a collection; shipped_rules_test.go asserts on literal clauses.
        const enabled = '@request.auth.disabled != true'

        const memberOf = ref =>
            `${ref}.project.boards_project_members_via_project.user ?= @request.auth.id`
        // The writing roles NAMED, never `?!= "viewer"` — trap 1 of
        // 1980000000, which is how drive silently granted commentor UPDATE.
        const writerOf = ref =>
            `${memberOf(ref)} && (${ref}.project.boards_project_members_via_project.role ?= "owner"` +
            ` || ${ref}.project.boards_project_members_via_project.role ?= "editor")`

        const eitherEnd = `(${memberOf('source')} || ${memberOf('target')})`

        // The share-token disjunct, and the single riskiest clause here.
        //
        // @collection registers an UNCONSTRAINED join —
        // registerJoin(..., nil), a bare cross join with no ON
        // (runner.go:181) — so a token clause missing its `project ?= <ref>`
        // correlation pairs ANY valid token with EVERY board's rows. On a
        // two-ended row that hazard is doubled: two joins, two correlations.
        //
        // ALIASED, and that is load-bearing. An unaliased @collection derives
        // ONE alias (1980000003 mechanic 4) and registerJoin replaces on alias
        // collision, so both ends' clauses would land on the SAME joined row —
        // making a two-project token expression unsatisfiable while looking
        // correct. `:src` and `:tgt` give two independent joins
        // (runner.go:172-176).
        const tokenOn = (alias, ref) => {
            const c = `@collection.boards_share_links:${alias}`
            return (
                `(${c}.token ?= @request.headers.x_share_token` +
                ` && ${c}.is_active ?= true` +
                ` && (${c}.expires_at ?= "" || ${c}.expires_at ?> @now)` +
                ` && ${c}.project ?= ${ref}.project)`
            )
        }
        const viaToken = `(${tokenOn('src', 'source')} || ${tokenOn('tgt', 'target')})`

        // TOP-LEVEL, never folded into `enabled &&`. `@request.auth.*` is SQL
        // NULL for an anonymous caller, so `enabled` is FALSE for exactly the
        // visitor this disjunct serves — conjoining it would be unsatisfiable
        // and would look right while being wrong (1980000003 mechanic 1).
        const readable = `(${enabled} && ${eitherEnd}) || ${viaToken}`

        const col = app.findCollectionByNameOrId('boards_card_links')
        col.listRule = readable
        col.viewRule = readable
        col.createRule = `${enabled} && ${writerOf('source')} && ${memberOf('target')}`
        // Never edited — retyping a link is a delete plus a create, which the
        // unique index already governs. The watchers/reactions shape.
        col.updateRule = null
        // Whoever may write the source card may unlink it. Deliberately NOT
        // the target's writers: the link hangs off the source, and a card on
        // the far board must not be able to quietly detach a dependency the
        // source board is tracking.
        col.deleteRule = `${enabled} && ${writerOf('source')}`
        app.save(col)

        const activity = app.findCollectionByNameOrId('boards_activity')
        const kind = activity.fields.getById('boards_activity_kind')
        kind.values = [...kind.values, 'link_added', 'link_removed']
        app.save(activity)
    },
    app => {
        const activity = app.findCollectionByNameOrId('boards_activity')
        const kind = activity.fields.getById('boards_activity_kind')
        kind.values = kind.values.filter(
            value => value !== 'link_added' && value !== 'link_removed'
        )
        app.save(activity)

        app.delete(app.findCollectionByNameOrId('boards_card_links'))
    }
)
