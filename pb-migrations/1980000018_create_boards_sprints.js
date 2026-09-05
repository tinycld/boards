/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// boards_sprints — a dated iteration of work, `boards_cards.sprint` naming
// one, boards_sprint_snapshots recording each sprint's progress by day, and
// the per-board settings that turn the feature on.
//
// THE SHAPE, against the two grouping rows that came before it. An epic
// (1980000017) groups by WHAT the work is and outlives every card in it; a
// sprint groups by WHEN, has a start and an end, is one of a numbered
// sequence, and — the part that makes it a different thing rather than a
// dated epic — cards LEAVE it. Completing a sprint rolls its unfinished cards
// forward into the next one or back to the backlog, so a sprint's membership
// is a moment in time and its final numbers have to be stamped rather than
// recounted (see the committed_* / completed_* columns below).
//
// SAME BOARD, like `epic` and `parent` and for the same reason: a sprint is a
// board's own plan, and a cross-board sprint would put 1980000016's
// two-project rule design onto a row that gains nothing from it. Pinned on
// the card's create and update below, asserted literally in
// shipped_rules_test.go.
//
// ONE ACTIVE SPRINT PER BOARD, and a sprint only ever moves forward
// (planned → active → completed). Neither is expressible in a rule — a rule
// sees one row and cannot count its siblings or compare a state to what it
// was — so both live in server/sprint_guard.go, where they FAIL the write.
//
// cascadeDelete: false on the card's `sprint`, the `epic`/`parent`
// asymmetry: deleting a sprint sends its cards back to the backlog, never
// destroys them. The column reads as a dangling id, which the client treats
// as unfiled exactly as it does for a deleted epic.
//
// SERVER-OWNED COLUMNS. `number` is allocated the way a card's is
// (server/sprint_number.go, a compare-and-swap on
// boards_projects.next_sprint_number — the same allocator, a second
// counter). The four rollup columns are recomputed by server/sprint_rollup.go
// under counters.go's doctrine. The lifecycle stamps — started_at,
// completed_at, committed_*, completed_*, rolled_count — are written by the
// start/complete transitions alone. None of these can be pinned by a rule
// (they are scalars), so server/sprint_owned_columns.go zeroes them on a
// client create and restores them on a client update; without that a member
// could forge a velocity number.
//
// POINTS ARE RAW ESTIMATES — no 1-point floor, unlike an epic's rollup. A
// sprint carries a count AND a points total, and the header shows points only
// when the board estimates (points_total > 0), so the floor an epic needs to
// make one number meaningful on every board is not needed here; and a
// velocity chart that silently counted unestimated cards as a point each
// would overstate every team that estimates some cards and not others.
//
// SNAPSHOTS. One row per active sprint per day, written by the sprint sweep
// (server/sprint_scheduler.go) and at the two transitions, never by a
// client — the boards_activity shape: readable by members and share-link
// visitors, no write rules at all. A burndown and a scope-vs-done graph read
// them; a row per day is far cheaper than replaying boards_activity for the
// same numbers, and survives a card being deleted (which takes its history
// with it).
//
// SETTINGS on boards_projects, owner-only for free (the project update rule
// is viaOwner — 1980000012's precedent). `sprints_enabled` is the opt-in:
// off, and no sprint affordance renders anywhere. `sprint_length_days` is
// 0 = the default of 14, PocketBase's reading of an omitted number.
migrate(
    app => {
        const sprints = new Collection({
            id: 'pbc_boards_sprints_01',
            name: 'boards_sprints',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'boards_sprints_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_boards_projects_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                // The 4 in "Sprint 4" — allocated by the server before the row
                // lands, exactly as a card's number is. Required, because a
                // sprint with no number cannot be named or addressed.
                {
                    id: 'boards_sprints_number',
                    name: 'number',
                    type: 'number',
                    required: true,
                    min: 1,
                    onlyInt: true,
                },
                // Optional: "Sprint 4" is a fine name and most teams never
                // give one. Blank renders as the number.
                {
                    id: 'boards_sprints_name',
                    name: 'name',
                    type: 'text',
                    required: false,
                    max: 100,
                },
                {
                    id: 'boards_sprints_goal',
                    name: 'goal',
                    type: 'text',
                    required: false,
                    max: 2000,
                },
                // Days, in the day frame `start`/`due` use on a card. Optional
                // while planned — a sprint can be named before it is dated —
                // and required once active (sprint_guard.go).
                {
                    id: 'boards_sprints_start',
                    name: 'start',
                    type: 'date',
                    required: false,
                },
                {
                    id: 'boards_sprints_end',
                    name: 'end',
                    type: 'date',
                    required: false,
                },
                {
                    id: 'boards_sprints_state',
                    name: 'state',
                    type: 'select',
                    required: true,
                    maxSelect: 1,
                    values: ['planned', 'active', 'completed'],
                },
                // A fractional rank ordering PLANNED sprints in the backlog
                // view. NOT unique — cli/rank.go's warning; every query orders
                // by `position, id`. Active and completed sprints order by
                // their dates, so the rank only matters while planned.
                {
                    id: 'boards_sprints_position',
                    name: 'position',
                    type: 'text',
                    required: false,
                    max: 100,
                },
                {
                    id: 'boards_sprints_started_at',
                    name: 'started_at',
                    type: 'date',
                    required: false,
                },
                {
                    id: 'boards_sprints_completed_at',
                    name: 'completed_at',
                    type: 'date',
                    required: false,
                },
                // The live rollup (server/sprint_rollup.go): every unarchived
                // card naming this sprint, and the subset in a done or
                // canceled list.
                {
                    id: 'boards_sprints_card_total',
                    name: 'card_total',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'boards_sprints_card_done',
                    name: 'card_done',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'boards_sprints_points_total',
                    name: 'points_total',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'boards_sprints_points_done',
                    name: 'points_done',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                // Stamped when the sprint STARTS: what the team committed to.
                // Jira's "commitment", the top line of a velocity chart.
                {
                    id: 'boards_sprints_committed_count',
                    name: 'committed_count',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'boards_sprints_committed_points',
                    name: 'committed_points',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                // Stamped when the sprint COMPLETES. Stamped rather than left to
                // the rollup because the rollover moves unfinished cards OUT of
                // the sprint, after which the live rollup would read as "all
                // done" — the wrong number for velocity.
                {
                    id: 'boards_sprints_completed_count',
                    name: 'completed_count',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'boards_sprints_completed_points',
                    name: 'completed_points',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'boards_sprints_rolled_count',
                    name: 'rolled_count',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                // Provenance. cascadeDelete: false and registered with core's
                // offboarding (server/register.go), like every other
                // created_by in the package.
                {
                    id: 'boards_sprints_created_by',
                    name: 'created_by',
                    type: 'relation',
                    required: false,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                {
                    id: 'boards_sprints_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'boards_sprints_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_boards_sprints_project` ON `boards_sprints` (`project`)',
            ],
        })
        app.save(sprints)

        const snapshots = new Collection({
            id: 'pbc_boards_sprint_snapshots_01',
            name: 'boards_sprint_snapshots',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'boards_sprint_snapshots_sprint',
                    name: 'sprint',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_boards_sprints_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                // Denormalized, as on every content row, so the read rule is
                // the ordinary one-hop viaMember.
                {
                    id: 'boards_sprint_snapshots_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_boards_projects_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'boards_sprint_snapshots_day',
                    name: 'day',
                    type: 'date',
                    required: true,
                },
                {
                    id: 'boards_sprint_snapshots_scope_count',
                    name: 'scope_count',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'boards_sprint_snapshots_scope_points',
                    name: 'scope_points',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'boards_sprint_snapshots_done_count',
                    name: 'done_count',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'boards_sprint_snapshots_done_points',
                    name: 'done_points',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'boards_sprint_snapshots_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
            ],
            indexes: [
                // One row per sprint per day: the sweep upserts against this.
                'CREATE UNIQUE INDEX `idx_boards_sprint_snapshots_sprint_day` ON `boards_sprint_snapshots` (`sprint`, `day`)',
                'CREATE INDEX `idx_boards_sprint_snapshots_project` ON `boards_sprint_snapshots` (`project`)',
            ],
        })
        app.save(snapshots)

        const cards = app.findCollectionByNameOrId('boards_cards')
        cards.fields.addAt(
            cards.fields.length,
            new Field({
                id: 'boards_cards_sprint',
                name: 'sprint',
                type: 'relation',
                required: false,
                collectionId: 'pbc_boards_sprints_01',
                cascadeDelete: false,
                maxSelect: 1,
            })
        )
        // The rollup recount and the backlog view both read every card in one
        // sprint; without this each is a table scan. Mirrors idx_boards_cards_epic.
        cards.indexes = [
            ...cards.indexes,
            'CREATE INDEX `idx_boards_cards_sprint` ON `boards_cards` (`sprint`)',
        ]
        app.save(cards)

        const projects = app.findCollectionByNameOrId('boards_projects')
        for (const field of [
            { id: 'boards_projects_sprints_enabled', name: 'sprints_enabled', type: 'bool' },
            {
                id: 'boards_projects_sprint_length_days',
                name: 'sprint_length_days',
                type: 'number',
                required: false,
                min: 0,
                max: 90,
                onlyInt: true,
            },
            { id: 'boards_projects_sprint_auto_start', name: 'sprint_auto_start', type: 'bool' },
            {
                id: 'boards_projects_sprint_auto_complete',
                name: 'sprint_auto_complete',
                type: 'bool',
            },
            // Where auto-complete sends unfinished cards, and the dialog's
            // default. '' reads as `next`.
            {
                id: 'boards_projects_sprint_rollover',
                name: 'sprint_rollover',
                type: 'select',
                required: false,
                maxSelect: 1,
                values: ['next', 'backlog'],
            },
            // The sprint allocator's state — 1980000004's next_number, a
            // second counter. Server-owned; a new board's insert omits it.
            {
                id: 'boards_projects_next_sprint_number',
                name: 'next_sprint_number',
                type: 'number',
                required: false,
                min: 0,
                onlyInt: true,
            },
        ]) {
            projects.fields.addAt(projects.fields.length, new Field(field))
        }
        app.save(projects)

        // Restated verbatim from 1980000000 — never re-read off a collection;
        // shipped_rules_test.go asserts on literal clauses.
        const enabled = '@request.auth.disabled != true'
        const viaMember = 'project.boards_project_members_via_project.user ?= @request.auth.id'
        const viaWriter =
            `${viaMember} && (project.boards_project_members_via_project.role ?= "owner"` +
            ' || project.boards_project_members_via_project.role ?= "editor")'
        const pinProject =
            '(@request.body.project:isset = false || @request.body.project = project)'

        // A share-link visitor reads sprints, because a shared board renders
        // the sprint chip on its cards and scopes its columns to the active
        // sprint. Inlined rather than appended to 1980000003, which is frozen
        // — the boards_epics precedent (1980000017).
        const tokenMatch =
            '@collection.boards_share_links.token ?= @request.headers.x_share_token'
        const tokenLive =
            '@collection.boards_share_links.is_active ?= true' +
            ' && (@collection.boards_share_links.expires_at ?= ""' +
            ' || @collection.boards_share_links.expires_at ?> @now)'
        const viaToken =
            `(${tokenMatch} && ${tokenLive}` + ' && @collection.boards_share_links.project ?= project)'
        const readable = `(${enabled} && ${viaMember}) || ${viaToken}`

        // boards_sprints: the boards_epics rules — members read, writers
        // write. A sprint is day-to-day workflow rather than board shape, so
        // an editor may create, start and complete one; the owner-only
        // decisions (whether the board has sprints at all, how long they run)
        // live on boards_projects and inherit viaOwner there.
        const sprintsCol = app.findCollectionByNameOrId('boards_sprints')
        sprintsCol.listRule = readable
        sprintsCol.viewRule = readable
        sprintsCol.createRule = `${enabled} && ${viaWriter}`
        sprintsCol.updateRule = `${enabled} && ${viaWriter} && ${pinProject}`
        sprintsCol.deleteRule = `${enabled} && ${viaWriter}`
        app.save(sprintsCol)

        // boards_sprint_snapshots: read-only, the boards_activity shape. The
        // three write rules are left nil — superusers only — because the
        // server is the only writer, and a client-writable snapshot would be
        // a client-writable burndown.
        const snapshotsCol = app.findCollectionByNameOrId('boards_sprint_snapshots')
        snapshotsCol.listRule = readable
        snapshotsCol.viewRule = readable
        app.save(snapshotsCol)

        // The same-board invariant on the card's side: 1980000017's three
        // branches, each earning its place for the same reasons.
        //   - `:isset = false` lets an ordinary PATCH through (trap 2).
        //   - `= ""` is how a card LEAVES a sprint; without it, un-filing
        //     would have to satisfy `"".project = project`.
        //   - `.project = project` is the invariant, one hop through the named
        //     sprint, reading the INCOMING body so it constrains the write.
        const pinSprintProject =
            '(@request.body.sprint:isset = false || @request.body.sprint = ""' +
            ' || @request.body.sprint.project = project)'

        // Restated verbatim from 1980000015 and 1980000017 rather than read
        // off the collection: these rules are append-only by hand, and
        // re-reading would silently carry forward whatever a later migration
        // left.
        const pinParentProject =
            '(@request.body.parent:isset = false || @request.body.parent = ""' +
            ' || @request.body.parent.project = project)'
        const pinEpicProject =
            '(@request.body.epic:isset = false || @request.body.epic = ""' +
            ' || @request.body.epic.project = project)'

        const cardsCol = app.findCollectionByNameOrId('boards_cards')
        cardsCol.createRule =
            `${enabled} && ${viaWriter} && ${pinParentProject} && ${pinEpicProject}` +
            ` && ${pinSprintProject}`
        cardsCol.updateRule =
            `${enabled} && ${viaWriter} && ${pinProject} && ${pinParentProject}` +
            ` && ${pinEpicProject} && ${pinSprintProject}`
        app.save(cardsCol)

        // One kind for both directions, as `parent` and `epic`: `to = ""` is a
        // card leaving a sprint, `from = ""` one joining, and a rollover
        // writes both halves.
        const activity = app.findCollectionByNameOrId('boards_activity')
        const kind = activity.fields.getById('boards_activity_kind')
        kind.values = [...kind.values, 'sprint']
        app.save(activity)
    },
    app => {
        const activity = app.findCollectionByNameOrId('boards_activity')
        const kind = activity.fields.getById('boards_activity_kind')
        kind.values = kind.values.filter(value => value !== 'sprint')
        app.save(activity)

        // Restores 1980000017's rules verbatim — the state before this ran.
        const enabled = '@request.auth.disabled != true'
        const viaMember = 'project.boards_project_members_via_project.user ?= @request.auth.id'
        const viaWriter =
            `${viaMember} && (project.boards_project_members_via_project.role ?= "owner"` +
            ' || project.boards_project_members_via_project.role ?= "editor")'
        const pinProject =
            '(@request.body.project:isset = false || @request.body.project = project)'
        const pinParentProject =
            '(@request.body.parent:isset = false || @request.body.parent = ""' +
            ' || @request.body.parent.project = project)'
        const pinEpicProject =
            '(@request.body.epic:isset = false || @request.body.epic = ""' +
            ' || @request.body.epic.project = project)'

        const cardsCol = app.findCollectionByNameOrId('boards_cards')
        cardsCol.createRule =
            `${enabled} && ${viaWriter} && ${pinParentProject} && ${pinEpicProject}`
        cardsCol.updateRule =
            `${enabled} && ${viaWriter} && ${pinProject} && ${pinParentProject} && ${pinEpicProject}`
        cardsCol.indexes = cardsCol.indexes.filter(
            index => !index.includes('idx_boards_cards_sprint')
        )
        cardsCol.fields.removeById('boards_cards_sprint')
        app.save(cardsCol)

        const projects = app.findCollectionByNameOrId('boards_projects')
        for (const id of [
            'boards_projects_sprints_enabled',
            'boards_projects_sprint_length_days',
            'boards_projects_sprint_auto_start',
            'boards_projects_sprint_auto_complete',
            'boards_projects_sprint_rollover',
            'boards_projects_next_sprint_number',
        ]) {
            projects.fields.removeById(id)
        }
        app.save(projects)

        app.delete(app.findCollectionByNameOrId('boards_sprint_snapshots'))
        app.delete(app.findCollectionByNameOrId('boards_sprints'))
    }
)
