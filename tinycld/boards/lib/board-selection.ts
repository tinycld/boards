// The selection as data: what it points at, and what the pickers should show
// for it. Pure so the range and mixed-state rules can be unit-tested without a
// store — the same split lib/move.ts and lib/selection-gesture.ts make.

import type { BoardCardView, BoardProject } from '../types'
import type { CardEntry } from './board-cards'
import { flattenCards } from './board-cards'

/**
 * The ordered card ids a shift-click range resolves against.
 *
 * The canvas walks board order (list by list, top to bottom — what j/k walk),
 * the table and timeline pass their own `visibleOrder`, which is the channel
 * `useBoardShortcuts` already takes for the same reason. Sharing one function
 * is what makes a range selected on the canvas and a range selected in the
 * table agree about what lies between two cards.
 */
export function selectionOrder(project: BoardProject, visibleOrder?: string[]): string[] {
    if (visibleOrder) return visibleOrder
    return flattenCards(project).map(entry => entry.card.id)
}

/**
 * The selected cards, RE-DERIVED from the live board.
 *
 * Ids that are no longer on the board are dropped silently. This is the
 * doctrine useBoardShortcuts states in its header — "re-derives the focused
 * card from `project` at call time" — applied to a set: another client
 * archiving a selected card between the selection and the action turns into a
 * skipped row rather than a write against a row that is gone. Doing it here,
 * at the moment of use, is also what lets the store hold a plain Set with no
 * effect chasing six live queries to prune it.
 */
export function resolveSelection(
    project: BoardProject,
    selectedIds: ReadonlySet<string>
): CardEntry[] {
    if (selectedIds.size === 0) return []
    return flattenCards(project).filter(entry => selectedIds.has(entry.card.id))
}

/**
 * Whether EVERY / SOME selected card carries `id` in a multi-relation field.
 *
 * A bulk picker has three states where a single card has two: every card has
 * the label, some do, none do. Mail draws the same distinction with its derived
 * `allSelectedRead`. The picker renders "some" as an indeterminate mark, and a
 * press on a partial selection ADDS to the cards that lack it rather than
 * toggling each independently — otherwise one press would both add and remove.
 */
export function allHave(cards: CardEntry[], field: 'labels' | 'assignees', id: string): boolean {
    return cards.length > 0 && cards.every(entry => hasRelation(entry, field, id))
}

export function someHave(cards: CardEntry[], field: 'labels' | 'assignees', id: string): boolean {
    return cards.some(entry => hasRelation(entry, field, id))
}

function hasRelation(entry: CardEntry, field: 'labels' | 'assignees', id: string): boolean {
    const values = field === 'labels' ? entry.card.labels : entry.card.assignees
    return values.some(value => value.id === id)
}

/**
 * The one value every selected card shares, or undefined when they differ.
 *
 * A picker marks its current row, and a mixed selection has no current row to
 * mark — showing one would assert something about the cards that is not true
 * ("None" checked for a selection where every card is Urgent).
 */
export function sharedValue<T>(
    cards: CardEntry[],
    read: (card: BoardCardView) => T
): T | undefined {
    if (cards.length === 0) return undefined
    const first = read(cards[0].card)
    return cards.every(entry => read(entry.card) === first) ? first : undefined
}

/**
 * How many of `options` SOME but not all of the selection carries.
 *
 * The pickers' rows are binary, so a partly-applied label cannot be drawn as a
 * third state inside the menu. Surfacing the count on the BUTTON instead warns
 * the user their selection is not uniform before they open it — which is the
 * thing that would otherwise surprise them when one press appears to do nothing
 * to half the cards.
 */
export function partialCount(
    cards: CardEntry[],
    field: 'labels' | 'assignees',
    options: { id: string }[]
): number {
    return options.filter(
        option => someHave(cards, field, option.id) && !allHave(cards, field, option.id)
    ).length
}
