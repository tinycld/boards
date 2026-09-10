/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// boards_pr_links — one pull request's association with one card.
// boards_project_repos — which repositories a board watches.
//
// THE LINK ROW IS THE TRIGGER SURFACE. Every trigger in this package is a row
// change in a collection; there is no external-event trigger type. So the
// webhook's whole job is to write here, and the rules engine reaches the rest
// through machinery that already exists.
//
// `project` is denormalized so the rules resolve membership in one hop — the
// convention every content row here follows — with `card.project = project` as
// the anti-desync pin on create. THE ROW MUST THEREFORE BE RE-STAMPED WHEN A
// CARD MOVES BOARDS (server/endpoints_move_card.go, BOTH child lists): a row
// left naming the source board is unreadable to everyone on the target.
// boards_comment_reactions shipped without that and was exactly this bug.
//
// TWO STATE COLUMNS, deliberately. `state` is provider-neutral
// (open/merged/closed) and is what the rollup reads; `review_state` carries the
// provider's review vocabulary. Folding them into one enum would mean a later
// GitLab or webhook-driven source either abusing `approved` to mean something
// slightly different, or needing the enum reinterpreted — and while APPENDING
// a value to a released migration is fine, REINTERPRETING one is not.
//
// `unlinked` is a tombstone, not a delete, and it is load-bearing. Branch-name
// linkage is re-derived from immutable branch state on every delivery, so a
// deleted row simply comes back on the next push. Only a tombstone survives
// re-derivation. See server/github_links.go.
migrate(
    app => {
        const cards = app.findCollectionByNameOrId('boards_cards')
        const projects = app.findCollectionByNameOrId('boards_projects')

        // --- boards_project_repos -------------------------------------------
        //
        // Owners attach and detach repositories; every member reads, because
        // the card UI shows PR chips to anyone who can see the card.
        const enabled = '@request.auth.id != "" && @request.auth.disabled != true'
        const viaMember =
            '@collection.boards_project_members.project ?= project && ' +
            '@collection.boards_project_members.user ?= @request.auth.id'
        const viaOwner =
            '@collection.boards_project_members.project ?= project && ' +
            '@collection.boards_project_members.user ?= @request.auth.id && ' +
            '@collection.boards_project_members.role ?= "owner"'

        // 1980000000's trap 2: `viaOwner` evaluates against the STORED
        // `project`, so without a pin an owner of project A could PATCH a
        // repo row they own with {"project": B} and repoint it at a board
        // they may not even belong to — the row's `repo`/`installation_id`
        // would then leak into B's card UI. `project` is the only relation
        // here, so the pin only needs the one clause; `:isset = false` still
        // lets an ordinary PATCH that echoes the row back through unchanged.
        const pinProjectOnUpdate =
            '(@request.body.project:isset = false || @request.body.project = project)'

        const repos = new Collection({
            id: 'pbc_boards_project_repos_01',
            name: 'boards_project_repos',
            type: 'base',
            system: false,
            listRule: `${enabled} && ${viaMember}`,
            viewRule: `${enabled} && ${viaMember}`,
            createRule: `${enabled} && ${viaOwner}`,
            updateRule: `${enabled} && ${viaOwner} && ${pinProjectOnUpdate}`,
            deleteRule: `${enabled} && ${viaOwner}`,
            fields: [
                {
                    id: 'boards_project_repos_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: projects.id,
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'boards_project_repos_repo',
                    name: 'repo',
                    type: 'text',
                    required: true,
                    max: 140,
                },
                {
                    id: 'boards_project_repos_installation',
                    name: 'installation_id',
                    type: 'text',
                    required: false,
                    max: 40,
                },
                {
                    id: 'boards_project_repos_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'boards_project_repos_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX idx_boards_project_repos_unique ' +
                    'ON boards_project_repos (project, repo)',
                'CREATE INDEX idx_boards_project_repos_repo ON boards_project_repos (repo)',
            ],
        })
        app.save(repos)

        // --- boards_pr_links ------------------------------------------------
        //
        // SERVER-WRITTEN except for the manual link. The webhook runs as a
        // superuser and bypasses these rules; what they govern is the client
        // path — a member linking a PR by URL, and unlinking one.
        //
        // Create and update need DIFFERENT pins even though both guard the
        // same invariant, because a bare field name resolves differently in
        // each: on CREATE there is no stored row yet, so `card`/`project`
        // read the incoming body directly, and `card.project = project` is
        // enough. On UPDATE a bare field name resolves against the STORED
        // row — 1980000000's trap 2 — so that same clause would compare
        // stored-vs-stored and constrain nothing about the write. A writer of
        // project A could then PATCH a link row they control with
        // {"project": B, "card": <a B card>}: the rule evaluates against A,
        // passes, and the write lands on B, a board they may not belong to.
        // The update pin therefore reads `@request.body.*` on both relations
        // this row carries, the 1980000015/1980000017 shape.
        const pinCardProject = 'card.project = project'
        const pinCardProjectOnUpdate =
            '(@request.body.card:isset = false || @request.body.card.project = project)' +
            ' && (@request.body.project:isset = false || @request.body.project = project)'
        const viaWriter =
            '@collection.boards_project_members.project ?= project && ' +
            '@collection.boards_project_members.user ?= @request.auth.id && ' +
            '(@collection.boards_project_members.role ?= "owner" || ' +
            '@collection.boards_project_members.role ?= "editor")'

        const links = new Collection({
            id: 'pbc_boards_pr_links_01',
            name: 'boards_pr_links',
            type: 'base',
            system: false,
            listRule: `${enabled} && ${viaMember}`,
            viewRule: `${enabled} && ${viaMember}`,
            createRule: `${enabled} && ${viaWriter} && ${pinCardProject}`,
            updateRule: `${enabled} && ${viaWriter} && ${pinCardProjectOnUpdate}`,
            deleteRule: `${enabled} && ${viaWriter}`,
            fields: [
                {
                    id: 'boards_pr_links_card',
                    name: 'card',
                    type: 'relation',
                    required: true,
                    collectionId: cards.id,
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'boards_pr_links_project',
                    name: 'project',
                    type: 'relation',
                    required: true,
                    collectionId: projects.id,
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'boards_pr_links_repo',
                    name: 'repo',
                    type: 'text',
                    required: true,
                    max: 140,
                },
                {
                    id: 'boards_pr_links_number',
                    name: 'number',
                    type: 'number',
                    required: true,
                    min: 1,
                },
                { id: 'boards_pr_links_url', name: 'url', type: 'url', required: false },
                {
                    id: 'boards_pr_links_title',
                    name: 'title',
                    type: 'text',
                    required: false,
                    max: 300,
                },
                {
                    id: 'boards_pr_links_author',
                    name: 'author',
                    type: 'text',
                    required: false,
                    max: 100,
                },
                {
                    id: 'boards_pr_links_state',
                    name: 'state',
                    type: 'select',
                    required: true,
                    maxSelect: 1,
                    values: ['open', 'merged', 'closed'],
                },
                {
                    id: 'boards_pr_links_review_state',
                    name: 'review_state',
                    type: 'select',
                    required: false,
                    maxSelect: 1,
                    values: ['in_review', 'approved'],
                },
                {
                    id: 'boards_pr_links_link_source',
                    name: 'link_source',
                    type: 'select',
                    required: true,
                    maxSelect: 1,
                    values: ['branch', 'title', 'body', 'manual'],
                },
                {
                    id: 'boards_pr_links_unlinked',
                    name: 'unlinked',
                    type: 'bool',
                    required: false,
                },
                {
                    id: 'boards_pr_links_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'boards_pr_links_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX idx_boards_pr_links_unique ' +
                    'ON boards_pr_links (repo, number, card)',
                'CREATE INDEX idx_boards_pr_links_card ON boards_pr_links (card)',
                'CREATE INDEX idx_boards_pr_links_repo_number ' +
                    'ON boards_pr_links (repo, number)',
            ],
        })
        app.save(links)

        // --- derived columns on the card ------------------------------------
        //
        // SERVER-OWNED, the epic-rollup shape: computed once and read by both
        // the trigger filters and the UI, so display and automation cannot
        // disagree. (Jira's do: its panel computes all-merged correctly while
        // its automation fires on the first merge.)
        cards.fields.add(
            new SelectField({
                id: 'boards_cards_pr_state',
                name: 'pr_state',
                required: false,
                maxSelect: 1,
                values: ['open', 'merged', 'closed'],
            })
        )
        cards.fields.add(
            new SelectField({
                id: 'boards_cards_pr_review_state',
                name: 'pr_review_state',
                required: false,
                maxSelect: 1,
                values: ['in_review', 'approved'],
            })
        )
        app.save(cards)

        // --- activity kinds -------------------------------------------------
        const activity = app.findCollectionByNameOrId('boards_activity')
        const kind = activity.fields.getById('boards_activity_kind')
        kind.values = [...kind.values, 'pr_linked', 'pr_unlinked', 'pr_merged']
        app.save(activity)
    },
    app => {
        const activity = app.findCollectionByNameOrId('boards_activity')
        const kind = activity.fields.getById('boards_activity_kind')
        kind.values = kind.values.filter(
            value => value !== 'pr_linked' && value !== 'pr_unlinked' && value !== 'pr_merged'
        )
        app.save(activity)

        const cards = app.findCollectionByNameOrId('boards_cards')
        cards.fields.removeById('boards_cards_pr_state')
        cards.fields.removeById('boards_cards_pr_review_state')
        app.save(cards)

        app.delete(app.findCollectionByNameOrId('boards_pr_links'))
        app.delete(app.findCollectionByNameOrId('boards_project_repos'))
    }
)
