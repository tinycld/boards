/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// M6a: anonymous share-link READ, as an access-rule disjunct.
//
// A visitor holding a link token reads the board through the NORMAL collections
// and the normal board UI. No membership row, no snapshot endpoint, no fake
// user. The token arrives as the `X-Share-Token` header — PocketBase snakecases
// header names, so the rule reads `@request.headers.x_share_token`
// (core/event_request.go:136-141) — and the rule validates it inline.
//
// Appended, not edited into 1980000000: that file is shipped, and PocketBase
// never re-runs an applied migration, so an in-place edit would silently never
// reach a database that already has it.
//
// The same disjunct serves REST and realtime. A realtime subscription carries
// per-topic options whose headers are snakecased identically
// (tools/subscriptions/client.go:163-192) and rebuilt into a RequestInfo before
// the rule runs (apis/realtime.go:634-648), so one rule covers both transports.
//
// ---------------------------------------------------------------------------
// SIX MECHANICS THIS DEPENDS ON. Each was read in the vendored fork at
// tinycld/third_party/pocketbase, not inferred. Any of them changing upstream
// breaks this file, which is why share_token_rls_test.go pins them
// BEHAVIOURALLY rather than trusting this comment.
//
// 1. WHY THE DISJUNCT IS TOP-LEVEL AND NEVER FOLDED INTO `enabled &&`.
//    `@request.auth.*` resolves to the SQL literal NULL for an unauthenticated
//    caller (core/record_field_resolver_runner.go:199-201), and `NULL != true`
//    is NULL — falsy. `enabled` is therefore FALSE for exactly the caller this
//    disjunct exists to serve. Conjoining it would make the whole clause
//    unsatisfiable, and it would look correct while doing it.
//
// 2. WHY `?=` AND NOT `=`. On a @collection join, plain `=` triggers PB's
//    multi-match wrapper (tools/search/filter.go:209-240), which means "ALL
//    rows of the joined set match" — here, every share link in the table. The
//    `?` forms are gated out of that wrapper (filter.go:449-464) and compile to
//    a bare comparison against the cross-joined alias, i.e. EXISTS. This is the
//    same operator inversion trap 4 of 1980000000 documents.
//
// 3. WHY THE `project` CLAUSE IS NOT OPTIONAL — the whole board isolation.
//    @collection registers an UNCONSTRAINED join: registerJoin(..., nil), a
//    bare LEFT JOIN with no ON (core/record_field_resolver_runner.go:181).
//    Without `...project ?= <ref>` the cross join pairs ANY valid token with
//    EVERY board's rows, so a link to one board would read them all. Nothing
//    else in the expression constrains which board a token unlocks.
//
// 4. WHY THE CLAUSES CORRELATE. An unaliased @collection.X derives ONE alias
//    (`__collection_cards_share_links`, runner:169-173) and registerJoin
//    replaces on alias collision (record_field_resolver.go:424-429), so all
//    four clauses land on the SAME joined row. An expired link cannot borrow
//    `is_active` from a live one.
//
// 5. WHY boards_share_links' OWNER-ONLY listRule DOES NOT BLOCK THIS.
//    A @collection join normally gets the joined collection's own listRule
//    AND-ed in (record_field_resolver.go:409-421 + :160-194) — which, being
//    owner-only, would make this disjunct permanently false for an anon. It
//    does not fire because every rule-evaluation path builds the resolver with
//    allowHiddenFields=true (apis/record_crud.go:64,171,441,563,747;
//    core/record_query.go:622). Load-bearing and undocumented upstream.
//
// 6. WHY `expires_at ?= ""` IS THE EMPTINESS TEST. An unset PB date column
//    stores the empty string, not NULL — the same idiom 1980000000 already uses
//    for `.id = ""`. `@now` (tools/search/identifier_macros.go:16-24) emits
//    PB's sortable `YYYY-MM-DD HH:MM:SS.sssZ`, the format the column itself
//    stores, so a lexicographic `?>` is a correct time comparison.
//
// ---------------------------------------------------------------------------
// READ-ONLY, STRUCTURALLY — not by client courtesy. Only list/view gain the
// disjunct. An anonymous caller cannot write regardless of the link's `role`,
// for three independent reasons: boards_comments.author,
// boards_attachments.uploaded_by and boards_cards.created_by are REQUIRED
// relations to users and an anon has no id to put in them; the create rules pin
// those fields to @request.auth.id, which is NULL; and no create/update/delete
// rule gains a disjunct here.
//
// So a link's `role` does NOT grant anonymous access at anything above viewer.
// It is a CEILING FOR REDEMPTION: the membership an OTP sign-in mints. Anyone
// reading `role: "editor"` on a link row and expecting an anonymous editor is
// reading it wrong.
//
// DELIBERATELY NOT TOUCHED:
//   - boards_project_members. The roster is the org's member names and emails;
//     rosterRule (`viaMember && notGuest`) and core's
//     1870000000_exclude_guests_from_org_rls exist precisely to keep a
//     share-link visitor out of it. A disjunct here would reopen both.
//   - boards_share_links. A token must never be able to enumerate tokens.
//   - Every create/update/delete rule, on every collection. That is what keeps
//     notGuest, pinProject/pinCard and bootstrapFirstOwner unreachable from
//     this change — each of them lives only on a rule that gains nothing here.
//
// One consequence worth stating because it looks like a bug and is not: a
// DISABLED user holding a link can read that board, since the disjunct does not
// mention auth. They gain nothing a logged-out browser would not — anyone with
// the link can read it — and `enabled` still gates the membership path, so a
// disabled user still cannot reach boards they merely belong to. Asserted in
// the suite so it is not "fixed" later.
migrate(
    app => {
        // Restated verbatim from 1980000000, never re-read off the collection.
        // Appending to a runtime-read rule would silently produce a different
        // expression if the base ever differed, and shipped_rules_test.go
        // asserts on literal clauses.
        const enabled = '@request.auth.disabled != true'
        const isMember = 'boards_project_members_via_project.user ?= @request.auth.id'
        const viaMember = 'project.boards_project_members_via_project.user ?= @request.auth.id'

        const tokenMatch =
            '@collection.boards_share_links.token ?= @request.headers.x_share_token'
        const tokenLive =
            '@collection.boards_share_links.is_active ?= true' +
            ' && (@collection.boards_share_links.expires_at ?= ""' +
            ' || @collection.boards_share_links.expires_at ?> @now)'

        // `ref` names the project from the row being accessed: `project` on a
        // content row, `id` on boards_projects itself. See mechanic 3.
        const viaTokenOn = ref =>
            `(${tokenMatch} && ${tokenLive}` +
            ` && @collection.boards_share_links.project ?= ${ref})`

        const readableBy = (memberClause, ref) =>
            `(${enabled} && ${memberClause}) || ${viaTokenOn(ref)}`

        const projectsCol = app.findCollectionByNameOrId('boards_projects')
        projectsCol.listRule = readableBy(isMember, 'id')
        projectsCol.viewRule = readableBy(isMember, 'id')
        app.save(projectsCol)

        for (const name of [
            'boards_lists',
            'boards_cards',
            'boards_labels',
            'boards_checklist_items',
            'boards_comments',
            'boards_attachments',
        ]) {
            const collection = app.findCollectionByNameOrId(name)
            collection.listRule = readableBy(viaMember, 'project')
            collection.viewRule = readableBy(viaMember, 'project')
            app.save(collection)
        }
    },
    app => {
        // Restores 1980000000's list/view rules verbatim. Written out rather
        // than derived by stripping a suffix, for the same reason the up does.
        const enabled = '@request.auth.disabled != true'
        const isMember = 'boards_project_members_via_project.user ?= @request.auth.id'
        const viaMember = 'project.boards_project_members_via_project.user ?= @request.auth.id'

        const projectsCol = app.findCollectionByNameOrId('boards_projects')
        projectsCol.listRule = `${enabled} && ${isMember}`
        projectsCol.viewRule = `${enabled} && ${isMember}`
        app.save(projectsCol)

        for (const name of [
            'boards_lists',
            'boards_cards',
            'boards_labels',
            'boards_checklist_items',
            'boards_comments',
            'boards_attachments',
        ]) {
            const collection = app.findCollectionByNameOrId(name)
            collection.listRule = `${enabled} && ${viaMember}`
            collection.viewRule = `${enabled} && ${viaMember}`
            app.save(collection)
        }
    }
)
