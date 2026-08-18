/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
// Cards: kanban projects, lists, cards and their content.
//
// SCHEMA NOTES
//
// `project` is DENORMALIZED onto every content collection (cards, checklist
// items, comments, attachments) rather than reached through `card.list.project`.
// Two reasons: an access rule resolves membership in one hop instead of three,
// and the anti-repoint pin below can guard `project` directly on each row. The
// cost is that the client must write `project` alongside `card`/`list` on every
// insert. See the desync limitation recorded at the end of this comment.
//
// `position` on lists and cards is a fractional rank STRING (see
// tinycld/cards/lib/rank.ts), not an integer: a move rewrites one row instead of
// renumbering every sibling, which is what makes an optimistic reorder safe.
// The rank alphabet is ASCII-ascending so JS string compare and SQLite's BINARY
// collation agree. Ranks are NOT unique — two offline clients inserting into the
// same gap produce the same string — so every board query must sort
// `ORDER BY position, id`, with id as the stable tiebreaker.
//
// RULE NOTES — four traps this file is written to avoid, the first three
// already paid for elsewhere in the ecosystem:
//
// 1. NEVER `role ?!= "viewer"` to mean "may write". It admits every role that is
//    not viewer, so `commentor` silently gains UPDATE the moment it exists.
//    drive/pb-migrations/1782100000 documents the damage. The writing roles are
//    NAMED below, so adding a fifth read-only role later cannot re-open this.
//
// 2. EVERY update rule pins its relations. A membership rule evaluates against
//    the row's STORED relation and never constrains the incoming body, so
//    without a pin an owner of project A can PATCH a row they control with
//    {"project": B} — the rule passes on A and the write lands on B, carrying
//    role:"owner" with it. Idiom from calendar/pb-migrations/1830000008:
//    (@request.body.x:isset = false || @request.body.x = x).
//    The pin lives in the RULE, not a Go hook: a hosted tenant runs no feature
//    Go, so the rule is the entire authorization.
//
// 3. `@request.auth.disabled != true`, never `= false`, so a record written
//    before the field existed — value absent rather than false — still passes.
//
// 4. `?=` CORRELATES, and the rules below depend on it. viaWriter asks two
//    questions of the same back-relation in separate clauses — "is one of these
//    members me?" and "is one of them an owner/editor?". Read naively that is
//    satisfiable by two DIFFERENT rows, which would hand every viewer on a
//    board that also has an editor full write access. It is not: `?=`
//    (SignAnyEq) is gated out of the MultiMatchSubquery wrapper
//    (tools/search/filter.go:210, :449) so it compiles to a bare comparison,
//    and repeated joins along one path dedupe to a single alias
//    (core/record_field_resolver.go:423-428,
//    record_field_resolver_runner.go:551). Both clauses therefore land on the
//    same joined row. The intuition inverts here — plain `=` is the operator
//    meaning "ALL elements match", which is why trap 1's `?!=` is trivially
//    true on any multi-member board. Do NOT "simplify" these rules by mixing
//    `?=` with `=` or by collapsing the clauses; M2a's correlation test
//    (a viewer alongside an editor) is what will catch it if someone does.
//
// GUESTS. A guest is a share-link visitor holding a real users record. Unlike
// drive, cards lets a guest CREATE content, because every content row names a
// `project` and the create rule can require the caller to already hold an
// editor/owner membership on it — the parent-check backstop drive's root-level
// items could not have. Guests still cannot create a PROJECT, and cannot read
// the member roster (that leak is what core's 1870000000 exists to close).
//
// KNOWN LIMITATIONS, recorded rather than solved (cf. calendar 1830000004):
//   - A rule cannot cross-check that @request.body.list belongs to the same
//     project as the row, so an editor of two boards can move a card between
//     them and desync `project` from `list.project`. Client mutations must
//     always write `project` and `list` together.
//   - Last-owner protection is not expressible: a rule sees one row and cannot
//     count the remaining owners, so an owner can orphan their own project.
migrate(
    app => {
        // Phase 1: Create all collections without access rules (avoids back-relation ordering issues)

        // 1. cards_projects
        const projects = new Collection({
            id: 'pbc_cards_projects_01',
            name: 'cards_projects',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'cards_projects_name',
                    name: 'name',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 200,
                },
                // Hex string, not a select enum: core's `labels.color` is the
                // same shape, and core's shared ColorPickerGrid emits hex. A
                // palette change must not need a migration.
                {
                    id: 'cards_projects_color',
                    name: 'color',
                    type: 'text',
                    required: true,
                    max: 20,
                },
                {
                    id: 'cards_projects_visibility',
                    name: 'visibility',
                    type: 'select',
                    required: true,
                    values: ['private', 'link'],
                    maxSelect: 1,
                },
                // cascadeDelete: false — deleting a user must not destroy the
                // team's board.
                {
                    id: 'cards_projects_created_by',
                    name: 'created_by',
                    type: 'relation',
                    required: true,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                {
                    id: 'cards_projects_archived',
                    name: 'archived',
                    type: 'bool',
                },
                {
                    id: 'cards_projects_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'cards_projects_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_cards_projects_created_by` ON `cards_projects` (`created_by`)',
            ],
        })
        app.save(projects)

        // 2. cards_project_members
        const members = new Collection({
            id: 'pbc_cards_members_01',
            name: 'cards_project_members',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'cards_members_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cards_projects_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cards_members_user',
                    name: 'user',
                    type: 'relation',
                    required: true,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                // Drive's vocabulary, verbatim. commentor reads and comments;
                // it never edits.
                {
                    id: 'cards_members_role',
                    name: 'role',
                    type: 'select',
                    required: true,
                    values: ['owner', 'editor', 'commentor', 'viewer'],
                    maxSelect: 1,
                },
                // Optional: the bootstrap-first-owner insert has no inviter to
                // record, and a required field would force every seed and test
                // path to invent one.
                {
                    id: 'cards_members_created_by',
                    name: 'created_by',
                    type: 'relation',
                    required: false,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                {
                    id: 'cards_members_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'cards_members_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_cards_members_unique` ON `cards_project_members` (`project`, `user`)',
                'CREATE INDEX `idx_cards_members_project` ON `cards_project_members` (`project`)',
                'CREATE INDEX `idx_cards_members_user` ON `cards_project_members` (`user`)',
            ],
        })
        app.save(members)

        // 3. cards_share_links
        //
        // Schema only this milestone — no token minting, OTP flow or public
        // route yet. It lands now because a shipped migration is frozen, and
        // adding the collection later would cost a second migration and a
        // version bump. Rules are owner-only.
        //
        // A link grants access by MINTING a cards_project_members row when it is
        // redeemed (drive's model), so every content rule below resolves through
        // membership alone and never has to know links exist.
        const shareLinks = new Collection({
            id: 'pbc_cards_share_links_01',
            name: 'cards_share_links',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'cards_sl_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cards_projects_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                // 64 hex chars = 32 bytes of entropy, minted server-side.
                {
                    id: 'cards_sl_token',
                    name: 'token',
                    type: 'text',
                    required: true,
                    min: 64,
                    max: 64,
                },
                // No 'owner': a link must never confer project ownership.
                {
                    id: 'cards_sl_role',
                    name: 'role',
                    type: 'select',
                    required: true,
                    values: ['viewer', 'commentor', 'editor'],
                    maxSelect: 1,
                },
                {
                    id: 'cards_sl_created_by',
                    name: 'created_by',
                    type: 'relation',
                    required: true,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                // Empty means never expires.
                {
                    id: 'cards_sl_expires_at',
                    name: 'expires_at',
                    type: 'date',
                    required: false,
                },
                // Revocation is reversible and keeps the same token.
                {
                    id: 'cards_sl_is_active',
                    name: 'is_active',
                    type: 'bool',
                },
                {
                    id: 'cards_sl_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'cards_sl_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_cards_sl_token` ON `cards_share_links` (`token`)',
                'CREATE INDEX `idx_cards_sl_project` ON `cards_share_links` (`project`)',
            ],
        })
        app.save(shareLinks)

        // 4. cards_labels — before cards_cards, which relates to it
        const labels = new Collection({
            id: 'pbc_cards_labels_01',
            name: 'cards_labels',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'cards_labels_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cards_projects_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cards_labels_name',
                    name: 'name',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 100,
                },
                {
                    id: 'cards_labels_color',
                    name: 'color',
                    type: 'text',
                    required: true,
                    max: 20,
                },
                {
                    id: 'cards_labels_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'cards_labels_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: ['CREATE INDEX `idx_cards_labels_project` ON `cards_labels` (`project`)'],
        })
        app.save(labels)

        // 5. cards_lists
        const lists = new Collection({
            id: 'pbc_cards_lists_01',
            name: 'cards_lists',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'cards_lists_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cards_projects_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cards_lists_name',
                    name: 'name',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 200,
                },
                // min: 1 rejects '' — an empty rank sorts before everything and
                // would silently corrupt board order.
                {
                    id: 'cards_lists_position',
                    name: 'position',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 64,
                },
                {
                    id: 'cards_lists_is_done',
                    name: 'is_done',
                    type: 'bool',
                },
                {
                    id: 'cards_lists_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'cards_lists_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_cards_lists_project` ON `cards_lists` (`project`)',
                'CREATE INDEX `idx_cards_lists_project_position` ON `cards_lists` (`project`, `position`)',
            ],
        })
        app.save(lists)

        // 6. cards_cards
        const cards = new Collection({
            id: 'pbc_cards_cards_01',
            name: 'cards_cards',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'cards_cards_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cards_projects_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                // cascadeDelete: true is the DB floor, not the policy. Without
                // it, deleting a list orphans its cards to a dangling relation
                // with no column to render in. The UI may still offer
                // move-to-neighbour before deleting.
                {
                    id: 'cards_cards_list',
                    name: 'list',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cards_lists_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cards_cards_position',
                    name: 'position',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 64,
                },
                {
                    id: 'cards_cards_title',
                    name: 'title',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 500,
                },
                // Markdown source.
                {
                    id: 'cards_cards_description',
                    name: 'description',
                    type: 'text',
                    required: false,
                    max: 5000,
                },
                {
                    id: 'cards_cards_due',
                    name: 'due',
                    type: 'date',
                    required: false,
                },
                {
                    id: 'cards_cards_assignees',
                    name: 'assignees',
                    type: 'relation',
                    required: false,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: false,
                    maxSelect: 20,
                },
                {
                    id: 'cards_cards_labels',
                    name: 'labels',
                    type: 'relation',
                    required: false,
                    collectionId: 'pbc_cards_labels_01',
                    cascadeDelete: false,
                    maxSelect: 20,
                },
                {
                    id: 'cards_cards_created_by',
                    name: 'created_by',
                    type: 'relation',
                    required: true,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                {
                    id: 'cards_cards_archived',
                    name: 'archived',
                    type: 'bool',
                },
                // Board-face counters. cards_checklist_items and cards_comments
                // sync on-demand — they are fetched only for the OPEN card — so
                // a checklist ratio or comment count is not available at rest,
                // which is exactly when the board face needs it. These are
                // maintained by server/counters.go (mail_threads.has_attachments
                // is the precedent) and are never written by a client.
                //
                // Always RECOMPUTED, never incremented: a delta drifts silently
                // under concurrent writes, and a COUNT(*) per event is cheap at
                // kanban scale.
                {
                    id: 'cards_cards_checklist_total',
                    name: 'checklist_total',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'cards_cards_checklist_done',
                    name: 'checklist_done',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'cards_cards_comment_count',
                    name: 'comment_count',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'cards_cards_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'cards_cards_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_cards_cards_list` ON `cards_cards` (`list`)',
                'CREATE INDEX `idx_cards_cards_list_position` ON `cards_cards` (`list`, `position`)',
                'CREATE INDEX `idx_cards_cards_project` ON `cards_cards` (`project`)',
                // Both due indexes serve the calendar event-source query, which
                // reads across a user's projects as well as within one.
                'CREATE INDEX `idx_cards_cards_due` ON `cards_cards` (`due`)',
                'CREATE INDEX `idx_cards_cards_project_due` ON `cards_cards` (`project`, `due`)',
            ],
        })
        app.save(cards)

        // 7. cards_checklist_items
        const checklistItems = new Collection({
            id: 'pbc_cards_checkitems_01',
            name: 'cards_checklist_items',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'cards_checkitems_card',
                    name: 'card',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cards_cards_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cards_checkitems_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cards_projects_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cards_checkitems_title',
                    name: 'title',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 500,
                },
                {
                    id: 'cards_checkitems_is_done',
                    name: 'is_done',
                    type: 'bool',
                },
                {
                    id: 'cards_checkitems_position',
                    name: 'position',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 64,
                },
                {
                    id: 'cards_checkitems_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'cards_checkitems_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_cards_checkitems_card` ON `cards_checklist_items` (`card`)',
                'CREATE INDEX `idx_cards_checkitems_card_position` ON `cards_checklist_items` (`card`, `position`)',
            ],
        })
        app.save(checklistItems)

        // 8. cards_comments — created WITHOUT `parent`; the self-relation needs
        // the collection to exist first (drive's drv_items_parent pattern).
        const comments = new Collection({
            id: 'pbc_cards_comments_01',
            name: 'cards_comments',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'cards_comments_card',
                    name: 'card',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cards_cards_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cards_comments_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cards_projects_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cards_comments_author',
                    name: 'author',
                    type: 'relation',
                    required: true,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                // min: 1 blocks an empty comment.
                {
                    id: 'cards_comments_body',
                    name: 'body',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 10000,
                },
                {
                    id: 'cards_comments_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'cards_comments_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: ['CREATE INDEX `idx_cards_comments_card` ON `cards_comments` (`card`)'],
        })
        app.save(comments)

        // 8b. Add the self-relation now that cards_comments exists. `indexes` is
        // REPLACED wholesale rather than appended, so the card index is restated.
        const commentsCol = app.findCollectionByNameOrId('cards_comments')
        commentsCol.fields.add(
            new Field({
                id: 'cards_comments_parent',
                name: 'parent',
                type: 'relation',
                required: false,
                collectionId: 'pbc_cards_comments_01',
                cascadeDelete: true,
                maxSelect: 1,
            })
        )
        commentsCol.indexes = [
            'CREATE INDEX `idx_cards_comments_card` ON `cards_comments` (`card`)',
            'CREATE INDEX `idx_cards_comments_parent` ON `cards_comments` (`parent`)',
        ]
        app.save(commentsCol)

        // 9. cards_attachments
        //
        // One row per file (maxSelect: 1), not a maxSelect:20 array on the card:
        // each attachment needs its own uploaded_by and its own delete rule.
        const attachments = new Collection({
            id: 'pbc_cards_attachments_01',
            name: 'cards_attachments',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'cards_attach_card',
                    name: 'card',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cards_cards_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cards_attach_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cards_projects_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                // No mimeTypes — a card attachment is arbitrary, as in drive.
                {
                    id: 'cards_attach_file',
                    name: 'file',
                    type: 'file',
                    required: true,
                    maxSelect: 1,
                    maxSize: 104857600,
                },
                // Storage accounting needs a size column to declare a manifest
                // quota against later.
                {
                    id: 'cards_attach_size',
                    name: 'size',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'cards_attach_uploaded_by',
                    name: 'uploaded_by',
                    type: 'relation',
                    required: true,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                {
                    id: 'cards_attach_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'cards_attach_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_cards_attach_card` ON `cards_attachments` (`card`)',
                'CREATE INDEX `idx_cards_attach_uploaded_by` ON `cards_attachments` (`uploaded_by`)',
            ],
        })
        app.save(attachments)

        // Phase 2: Apply access rules now that all collections exist and back-relations resolve

        const enabled = '@request.auth.disabled != true'
        const authed = '@request.auth.id != ""'
        const notGuest = '@request.auth.role != "guest"'

        // On cards_projects itself — the back-relation starts at the project row.
        const isMember = 'cards_project_members_via_project.user ?= @request.auth.id'
        const isOwner = `${isMember} && cards_project_members_via_project.role ?= "owner"`

        // One hop out, for any row carrying a `project` relation. The `user` and
        // `role` clauses below resolve against the SAME member row — see trap 4.
        const viaMember = 'project.cards_project_members_via_project.user ?= @request.auth.id'
        // The roles that may WRITE, named explicitly. See trap 1 above.
        const viaWriter =
            `${viaMember} && (project.cards_project_members_via_project.role ?= "owner"` +
            ' || project.cards_project_members_via_project.role ?= "editor")'
        // The roles that may COMMENT. viewer is excluded by omission, so a
        // future read-only role cannot inherit comment rights by accident.
        const viaCommenter =
            `${viaMember} && (project.cards_project_members_via_project.role ?= "owner"` +
            ' || project.cards_project_members_via_project.role ?= "editor"' +
            ' || project.cards_project_members_via_project.role ?= "commentor")'
        const viaOwner = `${viaMember} && project.cards_project_members_via_project.role ?= "owner"`

        // Anti-repoint pins. See trap 2 above.
        const pinProject =
            '(@request.body.project:isset = false || @request.body.project = project)'
        const pinCard = '(@request.body.card:isset = false || @request.body.card = card)'

        // Content rows pin their author/uploader to the caller on create, so a
        // row can never be attributed to someone else (core 1920000000).
        const isAuthor = 'author = @request.auth.id'
        const isUploader = 'uploaded_by = @request.auth.id'

        function setRules(collection, { list, view, create, update, del }) {
            collection.listRule = list
            collection.viewRule = view
            collection.createRule = create
            collection.updateRule = update
            collection.deleteRule = del
        }

        // cards_projects: members read; any non-guest authed user creates a
        // board; owners rename, archive and delete it. A fresh project has no
        // members yet, so create cannot test membership — notGuest is the only
        // thing standing between a share-link visitor and a new board.
        const projectsCol = app.findCollectionByNameOrId('cards_projects')
        setRules(projectsCol, {
            list: `${enabled} && ${isMember}`,
            view: `${enabled} && ${isMember}`,
            create: `${authed} && ${notGuest} && ${enabled}`,
            update: `${enabled} && ${isOwner}`,
            del: `${enabled} && ${isOwner}`,
        })
        app.save(projectsCol)

        // cards_project_members: you always see your own row; the full roster is
        // visible to non-guest members (the Share dialog and the header avatar
        // stack both need it) but never to a share-link guest, who would
        // otherwise read the org's member names and emails.
        const rosterRule = `(${viaMember} && ${notGuest})`
        const ownMemberRow = 'user = @request.auth.id'
        // An owner adds anyone — deliberately NOT conjoined with
        // `user = @request.auth.id`, which is why calendar owners cannot invite.
        const ownerCanAdd = viaOwner
        // The first owner of a brand-new project self-inserts: the owner-check
        // chain resolves to an empty set on a project with no members, so
        // without this branch no project could ever get its first member.
        // `.id = ""` (bare `=`) is PB's "back-relation set is empty" idiom.
        const bootstrapFirstOwner =
            'user = @request.auth.id && role = "owner"' +
            ' && project.cards_project_members_via_project.id = ""' +
            ` && ${notGuest}`
        const membersCol = app.findCollectionByNameOrId('cards_project_members')
        setRules(membersCol, {
            list: `${enabled} && (${ownMemberRow} || ${rosterRule})`,
            view: `${enabled} && (${ownMemberRow} || ${rosterRule})`,
            create: `${enabled} && ((${ownerCanAdd}) || (${bootstrapFirstOwner}))`,
            update: `${enabled} && ${viaOwner} && ${pinProject}`,
            del: `${enabled} && (${ownMemberRow} || ${viaOwner})`,
        })
        app.save(membersCol)

        // cards_share_links: owner-only in every direction. An editor or
        // commentor must not be able to mint a link that widens access.
        const shareLinksCol = app.findCollectionByNameOrId('cards_share_links')
        setRules(shareLinksCol, {
            list: `${enabled} && ${viaOwner}`,
            view: `${enabled} && ${viaOwner}`,
            create: `${enabled} && ${viaOwner}`,
            update: `${enabled} && ${viaOwner} && ${pinProject}`,
            del: `${enabled} && ${viaOwner}`,
        })
        app.save(shareLinksCol)

        // cards_labels + cards_lists + cards_cards: members read, writers write.
        // create carries no notGuest — viaWriter already requires an
        // editor/owner membership on the named project, which is the backstop
        // that lets a guest add a card to a board shared with them without
        // being able to forge one onto a board they cannot reach.
        const labelsCol = app.findCollectionByNameOrId('cards_labels')
        setRules(labelsCol, {
            list: `${enabled} && ${viaMember}`,
            view: `${enabled} && ${viaMember}`,
            create: `${enabled} && ${viaWriter}`,
            update: `${enabled} && ${viaWriter} && ${pinProject}`,
            del: `${enabled} && ${viaWriter}`,
        })
        app.save(labelsCol)

        const listsCol = app.findCollectionByNameOrId('cards_lists')
        setRules(listsCol, {
            list: `${enabled} && ${viaMember}`,
            view: `${enabled} && ${viaMember}`,
            create: `${enabled} && ${viaWriter}`,
            update: `${enabled} && ${viaWriter} && ${pinProject}`,
            del: `${enabled} && ${viaWriter}`,
        })
        app.save(listsCol)

        // cards_cards.created_by is deliberately NOT pinned to the caller, and
        // the asymmetry with its siblings is intentional: comments pin `author`
        // and attachments pin `uploaded_by` (below) because those rows ARE an
        // attribution — a comment credited to someone who did not write it is a
        // forgery. A card is shared work: any writer may create one on another
        // member's behalf (an importer, a template, a triage bot filing for the
        // reporter), and created_by records provenance rather than conferring
        // rights. Nothing reads it for authorization — the write rules are
        // membership+role based (viaWriter), so an unpinned value grants nobody
        // anything.
        const cardsCol = app.findCollectionByNameOrId('cards_cards')
        setRules(cardsCol, {
            list: `${enabled} && ${viaMember}`,
            view: `${enabled} && ${viaMember}`,
            create: `${enabled} && ${viaWriter}`,
            update: `${enabled} && ${viaWriter} && ${pinProject}`,
            del: `${enabled} && ${viaWriter}`,
        })
        app.save(cardsCol)

        const checkItemsCol = app.findCollectionByNameOrId('cards_checklist_items')
        setRules(checkItemsCol, {
            list: `${enabled} && ${viaMember}`,
            view: `${enabled} && ${viaMember}`,
            create: `${enabled} && ${viaWriter}`,
            update: `${enabled} && ${viaWriter} && ${pinProject} && ${pinCard}`,
            del: `${enabled} && ${viaWriter}`,
        })
        app.save(checkItemsCol)

        // cards_comments: a commentor may write one; the author is pinned to the
        // caller. update requires author AND current commenter standing, so a
        // user demoted to viewer cannot keep editing their old comments.
        // Deletion is author-or-project-owner (an owner is always a member).
        const commentsRulesCol = app.findCollectionByNameOrId('cards_comments')
        setRules(commentsRulesCol, {
            list: `${enabled} && ${viaMember}`,
            view: `${enabled} && ${viaMember}`,
            create: `${enabled} && ${viaCommenter} && ${isAuthor}`,
            update: `${enabled} && ${isAuthor} && ${viaCommenter} && ${pinProject} && ${pinCard}`,
            del: `${enabled} && (${isAuthor} || ${viaOwner})`,
        })
        app.save(commentsRulesCol)

        // cards_attachments: the viewRule gates BOTH the record and the file
        // BLOB, so one expression decides who reads a row and who is served its
        // bytes.
        //
        // That equivalence is not stock PocketBase. Upstream consults the
        // viewRule before serving /api/files/... only for a file field marked
        // `protected` (apis/file.go, `if fileField.Protected`), and no file
        // field in this workspace was — not cards', not mail's, not drive's,
        // not text's — so every attachment in every package was downloadable by
        // anyone who knew a record id and a filename, with no auth at all.
        // Writing M6a's share-token tests is what uncovered it.
        //
        // Fixed in the vendored fork (apis/file.go:111-152): the check is now
        // unconditional and `protected` means only "ALSO accept a ?token= file
        // token". share_token_rls_test.go pins the result — in particular
        // TestShareToken_ServesNoFileWithoutAToken is the regression guard for
        // the hole itself and would catch the gate being removed again.
        const attachmentsCol = app.findCollectionByNameOrId('cards_attachments')
        setRules(attachmentsCol, {
            list: `${enabled} && ${viaMember}`,
            view: `${enabled} && ${viaMember}`,
            create: `${enabled} && ${viaWriter} && ${isUploader}`,
            update: `${enabled} && ${viaWriter} && ${isUploader} && ${pinProject} && ${pinCard}`,
            del: `${enabled} && (${isUploader} || ${viaOwner})`,
        })
        app.save(attachmentsCol)
    },
    app => {
        // Reverse dependency order.
        const collections = [
            'cards_attachments',
            'cards_comments',
            'cards_checklist_items',
            'cards_cards',
            'cards_lists',
            'cards_labels',
            'cards_share_links',
            'cards_project_members',
            'cards_projects',
        ]
        for (const name of collections) {
            const collection = app.findCollectionByNameOrId(name)
            app.delete(collection)
        }
    }
)
