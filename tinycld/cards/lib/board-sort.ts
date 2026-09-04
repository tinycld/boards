// How a column's cards are ordered when the user asks for something other
// than the hand-arranged (rank) order.
//
// Every comparator falls back to `(position, id)`, the board's native order,
// so two cards that tie on the chosen field keep the order the user gave
// them — and so a sort is a stable reordering rather than a shuffle.

import type { BoardCardView } from '../types'
import { parseCardKey } from './card-key'
import { byCreatedThenId } from './created-order'
import { compareEstimate } from './estimate'
import { comparePriority } from './priority'

export type SortField = 'manual' | 'due' | 'created' | 'title' | 'key' | 'priority' | 'estimate'
export type SortDirection = 'asc' | 'desc'

export interface BoardSort {
    field: SortField
    direction: SortDirection
}

/** The hand-arranged order — what a board shows with no sort applied. */
export const MANUAL_SORT: BoardSort = Object.freeze({ field: 'manual', direction: 'asc' })

export const SORT_FIELD_LABELS: Record<SortField, string> = {
    manual: 'Manual order',
    due: 'Due date',
    created: 'Created',
    title: 'Title',
    key: 'Key',
    priority: 'Priority',
    estimate: 'Estimate',
}

type Comparator = (a: BoardCardView, b: BoardCardView) => number

/**
 * The comparator for `sort`, including direction.
 *
 * Two things do NOT flip with direction, deliberately: a card with no due
 * date always sorts after every dated one (it has nothing to be earlier or
 * later than), and the rank tiebreak stays ascending so ties always read in
 * board order. `manual` returns the rank comparator regardless of direction —
 * "manual, descending" is not a thing the board offers.
 */
export function compareCards(sort: BoardSort): Comparator {
    if (sort.field === 'manual') return byRank
    const field = sort.field
    const primary = PRIMARY[field]
    const sign = sort.direction === 'desc' ? -1 : 1
    return (a, b) => {
        // Decided BEFORE the sign is applied, so it holds in both directions.
        const aMissing = isMissing(field, a)
        const bMissing = isMissing(field, b)
        if (aMissing !== bMissing) return aMissing ? 1 : -1
        const result = primary(a, b)
        if (result !== 0) return result * sign
        return byRank(a, b)
    }
}

/**
 * A card with nothing to sort by on this field. Undated, unkeyed (the
 * optimistic beat before the server assigns a number), unstamped (same
 * beat, for `created`) and unestimated cards all belong at the end whichever
 * way the rest are ordered.
 */
function isMissing(field: Exclude<SortField, 'manual'>, card: BoardCardView): boolean {
    switch (field) {
        case 'due':
            return card.due === undefined
        case 'key':
            return keyNumber(card.key) === null
        case 'created':
            return card.created === ''
        case 'estimate':
            return card.estimate === undefined
        default:
            return false
    }
}

function byRank(a: BoardCardView, b: BoardCardView): number {
    if (a.position !== b.position) return a.position < b.position ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Both dated — compareCards has already sent the undated to the end. */
function byDue(a: BoardCardView, b: BoardCardView): number {
    return (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0)
}

function byTitle(a: BoardCardView, b: BoardCardView): number {
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
}

/**
 * By the numeric half of the key. Every card on one board shares a slug, so
 * the number is the whole ordering. Unkeyed cards never reach here — see
 * isMissing.
 */
function byKey(a: BoardCardView, b: BoardCardView): number {
    return (keyNumber(a.key) ?? 0) - (keyNumber(b.key) ?? 0)
}

function keyNumber(key: string): number | null {
    const parsed = parseCardKey(key)
    return parsed ? parsed.number : null
}

const PRIMARY: Record<Exclude<SortField, 'manual'>, Comparator> = {
    due: byDue,
    created: byCreatedThenId,
    title: byTitle,
    key: byKey,
    priority: (a, b) => comparePriority(a.priority, b.priority),
    estimate: (a, b) => compareEstimate(a.estimate, b.estimate),
}

/**
 * The sort a repeated press of the same field yields: same field, flipped
 * direction — the table-header convention.
 */
export function toggleSort(current: BoardSort, field: SortField): BoardSort {
    if (field === 'manual') return MANUAL_SORT
    if (current.field !== field) return { field, direction: 'asc' }
    return { field, direction: current.direction === 'asc' ? 'desc' : 'asc' }
}
