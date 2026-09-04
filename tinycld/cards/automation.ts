import type { AutomationDefinitions } from '@tinycld/core/lib/automation/types'
import type { CardsSchema } from './types'

// Every trigger here resolves owners through one cards_project_members
// resolver (server/automation.go). cards_cards has created_by, which the
// engine's auto-detection does NOT look for, and even declaring it as an
// ownerField would be wrong: it scopes a personal rule to whoever created the
// card, so a colleague moving your card would never fire your rule. Board
// membership is the honest answer to "whose card is this".
//
// This declaration is the DECLARATIVE half of the cards catalog. The actions
// that need Go — create-card (must resolve project from the list and let
// allocateNumber run), add-assignee / add-label (multi-relation `set`
// REPLACES, so append needs a handler), and set-due-date (date math) — are
// deliberately absent. add-assignee and add-label additionally want a
// relation param, which the catalog cannot express for a native action.
//
// A reaction is a row on cards_comment_reactions rather than a change to a
// card, so `comment-reacted` is declared against that collection; it carries
// `project` for the same owner resolver every card trigger uses.
const automation = {
    triggers: [
        {
            id: 'card-created',
            label: 'A card is created',
            collection: 'cards_cards',
            on: 'create',
            fields: [
                'title',
                'description',
                { key: 'list', label: 'List' },
                { key: 'project', label: 'Board' },
                'due',
                'start',
                { key: 'assignees', label: 'Assignees' },
                'labels',
                'priority',
                'estimate',
            ],
        },
        {
            id: 'card-moved',
            label: 'A card moves to another list',
            collection: 'cards_cards',
            on: 'update',
            // `position` changes on every reorder within a list, so watching
            // it would fire this on drag-to-reorder. Only a list change is a
            // move.
            watch: ['list'],
            fields: [
                'title',
                { key: 'list', label: 'List' },
                { key: 'project', label: 'Board' },
                'due',
                'start',
                { key: 'assignees', label: 'Assignees' },
                'priority',
                'estimate',
            ],
        },
        {
            // Same underlying event as card-moved, gated in Go to a list whose
            // category is `done`. Users expect "done" as its own event rather
            // than "moved + a condition on the destination", and a condition
            // couldn't express it anyway: the category lives on cards_lists,
            // and conditions see only the trigger collection's own columns.
            id: 'card-completed',
            label: 'A card is completed',
            collection: 'cards_cards',
            on: 'update',
            watch: ['list'],
            fields: [
                'title',
                { key: 'list', label: 'List' },
                { key: 'project', label: 'Board' },
                { key: 'assignees', label: 'Assignees' },
            ],
        },
        {
            // The other way work stops: gated in Go to a `canceled` list.
            // Separate from card-completed for the same reason that one is
            // separate from card-moved.
            id: 'card-canceled',
            label: 'A card is canceled',
            collection: 'cards_cards',
            on: 'update',
            watch: ['list'],
            fields: [
                'title',
                { key: 'list', label: 'List' },
                { key: 'project', label: 'Board' },
                { key: 'assignees', label: 'Assignees' },
            ],
        },
        {
            id: 'card-assigned',
            label: 'A card is assigned',
            collection: 'cards_cards',
            on: 'update',
            watch: ['assignees'],
            fields: [
                'title',
                { key: 'assignees', label: 'Assignees' },
                { key: 'list', label: 'List' },
                { key: 'project', label: 'Board' },
                'due',
                'start',
                'priority',
                'estimate',
            ],
        },
        {
            id: 'card-priority-changed',
            label: "A card's priority changes",
            collection: 'cards_cards',
            on: 'update',
            watch: ['priority'],
            fields: [
                'title',
                'priority',
                { key: 'list', label: 'List' },
                { key: 'project', label: 'Board' },
                { key: 'assignees', label: 'Assignees' },
            ],
        },
        {
            id: 'card-estimate-changed',
            label: "A card's estimate changes",
            collection: 'cards_cards',
            on: 'update',
            watch: ['estimate'],
            fields: [
                'title',
                'estimate',
                'priority',
                { key: 'list', label: 'List' },
                { key: 'project', label: 'Board' },
                { key: 'assignees', label: 'Assignees' },
            ],
        },
        {
            // Any of the three date columns: a start set, a due date moved,
            // a time added to or taken off a deadline.
            id: 'card-rescheduled',
            label: "A card's dates change",
            collection: 'cards_cards',
            on: 'update',
            watch: ['due', 'due_has_time', 'start'],
            fields: [
                'title',
                'due',
                'start',
                'priority',
                { key: 'list', label: 'List' },
                { key: 'project', label: 'Board' },
                { key: 'assignees', label: 'Assignees' },
            ],
        },
        {
            // Time-based, without a schedule. The due-notice sweep
            // (server/due_notices.go) already stamps a card when it crosses a
            // deadline boundary and saves it, and that save runs the ordinary
            // after-update hook — so watching the stamp turns the existing
            // ticker into a trigger with no scheduling machinery of its own.
            //
            // Deliberately NOT core:schedule, which is synthetic and fires
            // with no record: owners resolve through the card's board, and
            // every cards authorizer refuses a record-less request. A record
            // trigger also keeps conditions, which synthetic triggers cannot
            // have — "overdue AND priority is urgent" is most of the value.
            //
            // "Once per deadline" is inherited rather than reimplemented: the
            // stamp is a column, so it survives a restart, and rescheduling a
            // card clears it so the next deadline notifies again.
            id: 'card-overdue',
            label: 'A card becomes overdue',
            collection: 'cards_cards',
            on: 'update',
            watch: ['overdue_notified_at'],
            fields: [
                'title',
                'due',
                'start',
                'priority',
                'estimate',
                { key: 'list', label: 'List' },
                { key: 'project', label: 'Board' },
                { key: 'assignees', label: 'Assignees' },
            ],
        },
        {
            // card-overdue's sibling on the other boundary. Gated in Go to a
            // stamp that was just SET: rescheduling a card clears both stamps,
            // and a cleared stamp is the opposite of the event.
            id: 'card-due-soon',
            label: 'A card is due soon',
            collection: 'cards_cards',
            on: 'update',
            watch: ['due_soon_notified_at'],
            fields: [
                'title',
                'due',
                'start',
                'priority',
                'estimate',
                { key: 'list', label: 'List' },
                { key: 'project', label: 'Board' },
                { key: 'assignees', label: 'Assignees' },
            ],
        },
        {
            // `archived` flips both ways; gated in Go to the archive only, so
            // a restore never reads as "archived". Fires for the auto-archive
            // sweep's archives as well as a person's.
            id: 'card-archived',
            label: 'A card is archived',
            collection: 'cards_cards',
            on: 'update',
            watch: ['archived'],
            fields: [
                'title',
                { key: 'list', label: 'List' },
                { key: 'project', label: 'Board' },
                { key: 'assignees', label: 'Assignees' },
                'priority',
            ],
        },
        {
            // Fires in both directions — a card that becomes a sub-task and
            // one that stops being one — because "it left my epic" is as
            // worth a rule as "it joined it". A condition on `parent` being
            // empty separates them in the builder.
            id: 'card-parented',
            label: "A card's parent changes",
            collection: 'cards_cards',
            on: 'update',
            watch: ['parent'],
            fields: [
                'title',
                { key: 'parent', label: 'Parent card' },
                { key: 'list', label: 'List' },
                { key: 'project', label: 'Board' },
                { key: 'assignees', label: 'Assignees' },
            ],
        },
        {
            id: 'comment-reacted',
            label: 'Someone reacts to a comment',
            collection: 'cards_comment_reactions',
            on: 'create',
            fields: [
                'emoji',
                { key: 'user', label: 'Who reacted' },
                { key: 'card', label: 'Card' },
                { key: 'comment', label: 'Comment' },
                { key: 'project', label: 'Board' },
            ],
        },
    ],
    actions: [
        {
            // A record-op, so the engine executes it generically AND applies
            // the pkgaccess check that native handlers must make for
            // themselves. The param names the real `list` column, so the
            // catalog resolves its relation target and the builder renders a
            // real list picker.
            id: 'move-card',
            label: 'Move the card to a list',
            kind: 'record-op',
            collection: 'cards_cards',
            op: {
                type: 'update',
                target: 'trigger-record',
                set: { list: { param: 'list' } },
            },
            params: [{ key: 'list', field: 'list', label: 'Destination list' }],
        },
        {
            // A record-op like move-card: `priority` is a single select, so a
            // `set` is exactly the right verb — nothing to append to, nothing
            // to preserve. Naming the real column lets the catalog offer the
            // enum as the param's options; `none` is among them, which is
            // why the migration lists it as a value.
            id: 'set-priority',
            label: 'Set the card priority',
            kind: 'record-op',
            collection: 'cards_cards',
            op: {
                type: 'update',
                target: 'trigger-record',
                set: { priority: { param: 'priority' } },
            },
            params: [{ key: 'priority', field: 'priority', label: 'Priority' }],
        },
        {
            // A record-op like set-priority: one number column, so `set` is
            // the right verb. 0 is the stored form of "no estimate"
            // (lib/estimate.ts), so a rule can clear one as well as size it.
            id: 'set-estimate',
            label: 'Set the card estimate',
            kind: 'record-op',
            collection: 'cards_cards',
            op: {
                type: 'update',
                target: 'trigger-record',
                set: { estimate: { param: 'estimate' } },
            },
            params: [{ key: 'estimate', field: 'estimate', label: 'Estimate (points, 0 clears)' }],
        },
        {
            // A record-op like move-card: `parent` is a single relation, so a
            // `set` replaces nothing the user wanted kept. Naming the real
            // column gives the builder a card picker.
            //
            // The engine saves as a superuser and so bypasses the same-board
            // rule; parentAuthorizer in server/automation.go is what refuses a
            // parent on another board, or one that is itself a sub-task.
            id: 'set-parent',
            label: 'Make the card a sub-task',
            kind: 'record-op',
            collection: 'cards_cards',
            op: {
                type: 'update',
                target: 'trigger-record',
                set: { parent: { param: 'parent' } },
            },
            params: [{ key: 'parent', field: 'parent', label: 'Parent card' }],
        },
        {
            // Native, not a record-op: `assignees` is a multi-value relation
            // and a record-op `set` REPLACES the whole value, so appending one
            // assignee would silently drop the others.
            //
            // `relationTarget` is what lets a native action offer a picker at
            // all — a native action declares no collection, so there is no
            // column for the param to inherit a target from.
            id: 'add-assignee',
            label: 'Assign the card to someone',
            kind: 'native',
            params: [
                {
                    key: 'user',
                    type: 'relation',
                    relationTarget: 'users',
                    label: 'Assignee',
                },
            ],
        },
        {
            // Native for the same reason as add-assignee: `labels` is a
            // multi-value relation, so a record-op `set` would replace the
            // card's whole label set rather than add to it.
            id: 'add-label',
            label: 'Add a label to the card',
            kind: 'native',
            params: [
                {
                    key: 'label',
                    type: 'relation',
                    relationTarget: 'cards_labels',
                    label: 'Label',
                },
            ],
        },
    ],
} satisfies AutomationDefinitions<CardsSchema>

export default automation
