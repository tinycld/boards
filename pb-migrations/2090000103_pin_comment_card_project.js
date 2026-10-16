/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// A comment is created on its card's board.
//
// A comment carries a denormalized `project`, and every rule that reads it
// resolves membership through it, never through the card. The create rule
// (as 2040000001 left it) checked that the caller comments on `project` but
// not that `card` is on that board, so a commenter on board A could post a
// comment with project = A on a card of board B: B's members cannot read it,
// B's card still counts it, and the mention flow for it runs against B's
// card. Update already pins both fields to their stored values (pinProject,
// pinCard), so create was the one way in. 2090000102 closed the same hole for
// checklist items and attachments.
//
// On CREATE a bare field name reads the submitted record, so
// `card.project = project` compares the card the body names with the board
// the body names.
//
// The rule is restated as a literal, as 2040000001 left it, so
// shipped_rules_test.go can assert it; down restores it without the pin.

const member =
    '@request.auth.id != "" && @request.auth.disabled != true && ' +
    'project.boards_project_members_via_project.user ?= @request.auth.id'
const commenter =
    '(project.boards_project_members_via_project.role ?= "owner" || ' +
    'project.boards_project_members_via_project.role ?= "editor" || ' +
    'project.boards_project_members_via_project.role ?= "commentor")'
const pinCardProject = 'card.project = project'

function applyCreateRule(app, pin) {
    const col = app.findCollectionByNameOrId('boards_comments')
    col.createRule = `${member} && ${commenter} && author = @request.auth.id${pin}`
    app.save(col)
}

migrate(
    app => applyCreateRule(app, ` && ${pinCardProject}`),
    app => applyCreateRule(app, '')
)
