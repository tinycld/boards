/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// Group grants on boards_project_members.
//
// A row is one of three kinds, told apart by two fields:
//   direct  — user set, group empty  (every row before this migration)
//   grant   — user empty, group set  (client-written: "share with this group")
//   derived — both set               (core Go expands a grant into one row per
//                                     member; server-owned, never client-written)
// Content rules test `…_via_project.user ?= @request.auth.id` and so match a
// derived row exactly like a direct one. See core/server/groups.
//
// WHY EVERY RULE THAT READS boards_project_members.user NOW REQUIRES A LOGIN.
// A grant row stores user "". For a request with no login, PocketBase
// resolves @request.auth.id to NULL and rewrites `x = NULL` as
// `(x = '' OR x IS NULL)` — so `…_via_project.user ?= @request.auth.id`
// MATCHES a grant row, and a caller with no token gets the grant's role on the
// whole board: read every card, comment and attachment, and create, edit and
// delete cards, lists, labels and the grant itself. `@request.auth.disabled
// != true` does not stop it (NULL is not true either). So this migration
// conjoins `@request.auth.id != ""` with every member test, in every boards
// collection. On the read rules that also admit a share-link token, the guard
// goes inside the member branch only, so anonymous share-link reads still
// work. rlstest.RequireAuthGuardOnGrantRules fails the build if a later rule
// forgets it. (boards_project_repos and boards_pr_links already carry it.)
//
// Two more rules gain the guard here, for the same reason:
//   - comment_mentions.createRule's boards branch (1986000000) tests
//     `…_via_project.user ?= @request.auth.id` too, so a grant row let an
//     anonymous caller write a mention — and so a notification — for any user.
//     The table is core's and its rule is shared by every package, so the
//     branch is rewritten in place by its predicate rather than restated.
//   - the own-row delete rules on watchers and reactions (`user =
//     @request.auth.id`). They are safe today only because `user` is
//     required there; the guard stops them depending on that.
// rlstest.RequireAuthGuardOnAccessRules fails the build on any rule that
// reads @request.auth on a path without the guard.
//
// Rules are restated as literals, never read back off the collection
// (shipped_rules_test.go asserts them): boards_project_members from
// 1980000000 with the new clauses appended, the other collections from their
// latest setters with the login guard added. The down migration restates the
// same literals without the guard.
// Every boards rule outside boards_project_members that tests
// boards_project_members.user, as the migrations before this one left them,
// with `guard` in front of each member test. Up passes the login guard; down
// passes '' to restore them exactly.
function grantReachingRules(guard) {
    const enabled = '@request.auth.disabled != true'
    const members = 'boards_project_members_via_project'
    const viaMember = `project.${members}.user ?= @request.auth.id`
    const role = r => `project.${members}.role ?= "${r}"`
    const owner = role('owner')
    const writer = `(${role('owner')} || ${role('editor')})`
    const commenter = `(${role('owner')} || ${role('editor')} || ${role('commentor')})`
    const pinProject = '(@request.body.project:isset = false || @request.body.project = project)'
    const pinCard = '(@request.body.card:isset = false || @request.body.card = card)'
    const pinBody = f => `(@request.body.${f}:isset = false || @request.body.${f} = "" || @request.body.${f}.project = project)`

    // 1980000003's share-token disjunct. It stays unguarded: it is how an
    // anonymous share-link visitor reads a board.
    const link = alias => `@collection.boards_share_links${alias}`
    const token = (ref, alias = '') =>
        `(${link(alias)}.token ?= @request.headers.x_share_token && ${link(alias)}.is_active ?= true && ` +
        `(${link(alias)}.expires_at ?= "" || ${link(alias)}.expires_at ?> @now) && ${link(alias)}.project ?= ${ref})`

    const member = `${guard}${enabled} && ${viaMember}`
    const read = `(${member}) || ${token('project')}`
    const readRules = { listRule: read, viewRule: read }
    const writeRules = {
        createRule: `${member} && ${writer}`,
        updateRule: `${member} && ${writer} && ${pinProject}`,
        deleteRule: `${member} && ${writer}`,
    }

    const projectMember = `${guard}${enabled} && ${members}.user ?= @request.auth.id`
    const projectRead = `(${projectMember}) || ${token('id')}`
    const projectOwner = `${projectMember} && ${members}.role ?= "owner"`

    const src = `source.project.${members}`
    const tgt = `target.project.${members}`

    return {
        boards_projects: {
            listRule: projectRead,
            viewRule: projectRead,
            updateRule: projectOwner,
            deleteRule: projectOwner,
        },
        boards_share_links: {
            listRule: `${member} && ${owner}`,
            viewRule: `${member} && ${owner}`,
            createRule: `${member} && ${owner}`,
            updateRule: `${member} && ${owner} && ${pinProject}`,
            deleteRule: `${member} && ${owner}`,
        },
        boards_labels: { ...readRules, ...writeRules },
        boards_lists: { ...readRules, ...writeRules },
        boards_epics: { ...readRules, ...writeRules },
        boards_sprints: { ...readRules, ...writeRules },
        boards_cards: {
            ...readRules,
            createRule: `${member} && ${writer} && ${pinBody('parent')} && ${pinBody('epic')} && ${pinBody('sprint')}`,
            updateRule: `${member} && ${writer} && ${pinProject} && ${pinBody('parent')} && ${pinBody('epic')} && ${pinBody('sprint')}`,
            deleteRule: `${member} && ${writer}`,
        },
        boards_checklist_items: {
            ...readRules,
            createRule: `${member} && ${writer}`,
            updateRule: `${member} && ${writer} && ${pinProject} && ${pinCard}`,
            deleteRule: `${member} && ${writer}`,
        },
        boards_comments: {
            ...readRules,
            createRule: `${member} && ${commenter} && author = @request.auth.id`,
            updateRule: `${guard}${enabled} && author = @request.auth.id && ${viaMember} && ${commenter} && ${pinProject} && ${pinCard}`,
            deleteRule: `${guard}${enabled} && (author = @request.auth.id || ${viaMember} && ${owner})`,
        },
        boards_attachments: {
            ...readRules,
            createRule: `${member} && ${writer} && uploaded_by = @request.auth.id`,
            updateRule: `${member} && ${writer} && uploaded_by = @request.auth.id && ${pinProject} && ${pinCard}`,
            deleteRule: `${guard}${enabled} && (uploaded_by = @request.auth.id || ${viaMember} && ${owner})`,
        },
        boards_activity: readRules,
        boards_sprint_snapshots: readRules,
        boards_card_watchers: {
            listRule: member,
            viewRule: member,
            createRule: `${member} && user = @request.auth.id && card.project = project`,
        },
        boards_comment_reactions: {
            ...readRules,
            createRule: `${member} && ${commenter} && user = @request.auth.id && comment.card = card && card.project = project`,
        },
        boards_card_reactions: {
            ...readRules,
            createRule: `${member} && ${commenter} && user = @request.auth.id && card.project = project`,
        },
        boards_card_links: {
            listRule:
                `(${guard}${enabled} && (${src}.user ?= @request.auth.id || ${tgt}.user ?= @request.auth.id)) || ` +
                `(${token('source.project', ':src')} || ${token('target.project', ':tgt')})`,
            viewRule:
                `(${guard}${enabled} && (${src}.user ?= @request.auth.id || ${tgt}.user ?= @request.auth.id)) || ` +
                `(${token('source.project', ':src')} || ${token('target.project', ':tgt')})`,
            createRule:
                `${guard}${enabled} && ${src}.user ?= @request.auth.id && ` +
                `(${src}.role ?= "owner" || ${src}.role ?= "editor") && ${tgt}.user ?= @request.auth.id`,
            deleteRule: `${guard}${enabled} && ${src}.user ?= @request.auth.id && (${src}.role ?= "owner" || ${src}.role ?= "editor")`,
        },
    }
}

// The own-row delete rules from 1980000009, 1980000013 and 1980000020, with
// `guard` in front. Up passes the login guard; down passes '' to restore them.
function ownRowDeleteRules(guard) {
    const deleteRule = `${guard}@request.auth.disabled != true && user = @request.auth.id`
    return {
        boards_card_watchers: { deleteRule },
        boards_comment_reactions: { deleteRule },
        boards_card_reactions: { deleteRule },
    }
}

// boards' branch of comment_mentions.createRule starts with this predicate
// (1986000000). Up inserts the login guard right after it; down removes it.
const mentionsBranchStart = 'target_collection = "boards_cards" && '
const mentionsBranchGuarded = `${mentionsBranchStart}@request.auth.id != "" && `

function rewriteMentionsBranch(app, from, to) {
    let mentions
    try {
        mentions = app.findCollectionByNameOrId('comment_mentions')
    } catch {
        return
    }
    const current = mentions.createRule || ''
    if (current.indexOf(from) === -1) return
    mentions.createRule = current.replace(from, to)
    app.save(mentions)
}

function applyRules(app, byCollection) {
    for (const [name, rules] of Object.entries(byCollection)) {
        const col = app.findCollectionByNameOrId(name)
        for (const [kind, rule] of Object.entries(rules)) {
            col[kind] = rule
        }
        app.save(col)
    }
}

migrate(
    app => {
        const members = app.findCollectionByNameOrId('boards_project_members')

        const user = members.fields.getById('boards_members_user')
        user.required = false

        members.fields.addAt(
            members.fields.length,
            new Field({
                id: 'boards_members_group',
                name: 'group',
                type: 'relation',
                required: false,
                collectionId: 'pbc_groups_01',
                cascadeDelete: true,
                maxSelect: 1,
            })
        )

        members.indexes = [
            ...members.indexes.filter(idx => !idx.includes('idx_boards_members_unique')),
            'CREATE UNIQUE INDEX `idx_boards_members_unique` ON `boards_project_members` (`project`, `user`, `group`)',
            'CREATE INDEX `idx_boards_members_group` ON `boards_project_members` (`group`)',
        ]

        // A grant row's user is "", which an anonymous request's NULL
        // @request.auth.id matches; see the header.
        const authed = '@request.auth.id != ""'
        const enabled = '@request.auth.disabled != true'
        const notGuest = '@request.auth.role != "guest"'
        const viaMember = 'project.boards_project_members_via_project.user ?= @request.auth.id'
        const viaOwner = `${viaMember} && project.boards_project_members_via_project.role ?= "owner"`
        const pinProject = '(@request.body.project:isset = false || @request.body.project = project)'
        const pinUser = '(@request.body.user:isset = false || @request.body.user = user)'
        const pinGroup = '(@request.body.group:isset = false || @request.body.group = group)'
        const rosterRule = `(${viaMember} && ${notGuest})`
        const ownMemberRow = 'user = @request.auth.id'
        const ownerCanAdd = viaOwner
        const bootstrapFirstOwner =
            'user = @request.auth.id && role = "owner"' +
            ' && project.boards_project_members_via_project.id = ""' +
            ` && ${notGuest}`
        // A client writes direct rows and grants; derived rows (both set) are
        // core's. A grant never carries owner, so last-owner guards keep meaning.
        const notDerived = '(user = "" || group = "")'
        // On CREATE, PocketBase evaluates a bare field name against the
        // submitted record, so `role` here already reads the request body.
        const groupNeverOwnerOnCreate = '(group = "" || role != "owner")'
        // On UPDATE, a bare field name reads the STORED row instead (the same
        // reason pinProject/pinUser/pinGroup compare @request.body.x to bare
        // x) — so a bare `role != "owner"` here would check the value BEFORE
        // the PATCH applied and let a grant be re-roled to owner. Read the
        // body explicitly. `group` stays bare on purpose: it identifies the
        // row as a grant, and pinGroup already stops the body from changing
        // it mid-request.
        const groupNeverOwnerOnUpdate =
            '(group = "" || @request.body.role:isset = false || @request.body.role != "owner")'

        members.listRule = `${authed} && ${enabled} && (${ownMemberRow} || ${rosterRule})`
        members.viewRule = `${authed} && ${enabled} && (${ownMemberRow} || ${rosterRule})`
        members.createRule = `${authed} && ${enabled} && ${notDerived} && ${groupNeverOwnerOnCreate} && ((${ownerCanAdd}) || (${bootstrapFirstOwner}))`
        members.updateRule = `${authed} && ${enabled} && ${notDerived} && ${groupNeverOwnerOnUpdate} && ${viaOwner} && ${pinProject} && ${pinUser} && ${pinGroup}`
        members.deleteRule = `${authed} && ${enabled} && ${notDerived} && (${ownMemberRow} || ${viaOwner})`

        app.save(members)

        applyRules(app, grantReachingRules(`${authed} && `))
        applyRules(app, ownRowDeleteRules(`${authed} && `))
        rewriteMentionsBranch(app, mentionsBranchStart, mentionsBranchGuarded)
    },
    app => {
        const members = app.findCollectionByNameOrId('boards_project_members')

        // Derived and grant rows cannot survive without the field.
        app.db().newQuery('DELETE FROM boards_project_members WHERE `group` != ""').execute()

        members.fields.removeById('boards_members_group')
        members.fields.getById('boards_members_user').required = true
        members.indexes = [
            ...members.indexes.filter(
                idx => !idx.includes('idx_boards_members_unique') && !idx.includes('idx_boards_members_group')
            ),
            'CREATE UNIQUE INDEX `idx_boards_members_unique` ON `boards_project_members` (`project`, `user`)',
        ]

        const enabled = '@request.auth.disabled != true'
        const notGuest = '@request.auth.role != "guest"'
        const viaMember = 'project.boards_project_members_via_project.user ?= @request.auth.id'
        const viaOwner = `${viaMember} && project.boards_project_members_via_project.role ?= "owner"`
        const pinProject = '(@request.body.project:isset = false || @request.body.project = project)'
        const rosterRule = `(${viaMember} && ${notGuest})`
        const ownMemberRow = 'user = @request.auth.id'
        const bootstrapFirstOwner =
            'user = @request.auth.id && role = "owner"' +
            ' && project.boards_project_members_via_project.id = ""' +
            ` && ${notGuest}`
        members.listRule = `${enabled} && (${ownMemberRow} || ${rosterRule})`
        members.viewRule = `${enabled} && (${ownMemberRow} || ${rosterRule})`
        members.createRule = `${enabled} && ((${viaOwner}) || (${bootstrapFirstOwner}))`
        members.updateRule = `${enabled} && ${viaOwner} && ${pinProject}`
        members.deleteRule = `${enabled} && (${ownMemberRow} || ${viaOwner})`
        app.save(members)

        applyRules(app, grantReachingRules(''))
        applyRules(app, ownRowDeleteRules(''))
        rewriteMentionsBranch(app, mentionsBranchGuarded, mentionsBranchStart)
    }
)
