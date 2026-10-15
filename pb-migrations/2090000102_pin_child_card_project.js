/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// A checklist item and an attachment are created on their card's board.
//
// Both rows carry a denormalized `project`, and every rule that reads them
// resolves membership through it, never through the card. The create rules
// (as 2040000001 left them) checked that the caller writes on `project` but
// not that `card` is on that board, so a writer on boards A and B could
// create a row with project = A on a card of board B: B's card counts it
// (checklist_total, attachment_count) while B's members cannot read it, and
// A's members read a row hung off a card they cannot open. Update already
// pins both fields to their stored values (pinProject, pinCard), so create
// was the one way in. boards_pr_links, the watchers and the reactions carry
// the same clause on create.
//
// On CREATE a bare field name reads the submitted record, so
// `card.project = project` compares the card the body names with the board
// the body names.
//
// Rules are restated as literals, as 2040000001 left them, so
// shipped_rules_test.go can assert them; down restores them without the pin.

const member =
    '@request.auth.id != "" && @request.auth.disabled != true && ' +
    'project.boards_project_members_via_project.user ?= @request.auth.id'
const writer =
    '(project.boards_project_members_via_project.role ?= "owner" || ' +
    'project.boards_project_members_via_project.role ?= "editor")'
const pinCardProject = 'card.project = project'

function createRules(pin) {
    return {
        boards_checklist_items: `${member} && ${writer}${pin}`,
        boards_attachments: `${member} && ${writer} && uploaded_by = @request.auth.id${pin}`,
    }
}

function applyCreateRules(app, rules) {
    for (const [name, createRule] of Object.entries(rules)) {
        const col = app.findCollectionByNameOrId(name)
        col.createRule = createRule
        app.save(col)
    }
}

migrate(
    app => applyCreateRules(app, createRules(` && ${pinCardProject}`)),
    app => applyCreateRules(app, createRules(''))
)
