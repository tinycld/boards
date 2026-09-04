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
