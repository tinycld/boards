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
// derived row exactly like a direct one. Nothing outside this collection
// changes. See core/server/groups.
//
// Rules are restated verbatim from 1980000000 with the new clauses appended,
// never read back off the collection (shipped_rules_test.go asserts literals).
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
        const groupNeverOwner = '(group = "" || role != "owner")'

        members.listRule = `${enabled} && (${ownMemberRow} || ${rosterRule})`
        members.viewRule = `${enabled} && (${ownMemberRow} || ${rosterRule})`
        members.createRule = `${enabled} && ${notDerived} && ${groupNeverOwner} && ((${ownerCanAdd}) || (${bootstrapFirstOwner}))`
        members.updateRule = `${enabled} && ${notDerived} && ${groupNeverOwner} && ${viaOwner} && ${pinProject} && ${pinUser} && ${pinGroup}`
        members.deleteRule = `${enabled} && ${notDerived} && (${ownMemberRow} || ${viaOwner})`

        app.save(members)
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
    }
)
