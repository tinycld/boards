// The board filter: what it is, and whether a card passes it.
//
// Pure, on the VIEW model rather than the record: labels and the reporter are
// already resolved, `due` is a Date, `key` is formatted — so the predicate
// reads what the face shows and the tests build views, not rows.
//
// Sentinels rather than resolved ids for "me" and "unassigned" keep a filter
// portable: the same value means the same thing for whoever holds it, which
// is what a shared or persisted filter would need, and it costs one lookup at
// match time.

import type { BoardCardView } from '../types'
import { dueStateFor } from './due-state'
import { isClosedCategory, type ListCategory } from './list-category'
import type { CardPriority } from './priority'

export type DueFilter = 'overdue' | 'soon' | 'has' | 'none'
export type EstimateFilter = 'estimated' | 'unestimated'

/** The current user, wherever an assignee or reporter id is expected. */
export const ME = 'me'
/** No assignee at all. Only meaningful in `assigneeIds`. */
export const UNASSIGNED = 'unassigned'

export interface BoardFilter {
    /** OR within the facet: a card with ANY of these labels passes. */
    labelIds: string[]
    /** User ids, `ME`, or `UNASSIGNED`. OR within the facet. */
    assigneeIds: string[]
    /** User ids or `ME`. OR within the facet. */
    reporterIds: string[]
    due: DueFilter | null
    priorities: CardPriority[]
    estimate: EstimateFilter | null
    /** The status of the card's list. OR within the facet. */
    statuses: ListCategory[]
    /** Case-insensitive substring over the title and the key. */
    text: string
}

/**
 * The one "no filter" value. A CONSTANT rather than a factory so a selector
 * returning it for an unset board hands back the same identity every render
 * — anything memoized on the filter then stays put until a real change.
 */
export const EMPTY_FILTER: BoardFilter = Object.freeze({
    labelIds: [],
    assigneeIds: [],
    reporterIds: [],
    due: null,
    priorities: [],
    estimate: null,
    statuses: [],
    text: '',
})

export function isFilterActive(filter: BoardFilter): boolean {
    return activeFacetCount(filter) > 0
}

/** How many facets constrain anything — what the filter button's badge shows. */
export function activeFacetCount(filter: BoardFilter): number {
    let count = 0
    if (filter.labelIds.length > 0) count += 1
    if (filter.assigneeIds.length > 0) count += 1
    if (filter.reporterIds.length > 0) count += 1
    if (filter.due !== null) count += 1
    if (filter.priorities.length > 0) count += 1
    if (filter.estimate !== null) count += 1
    if (filter.statuses.length > 0) count += 1
    if (filter.text.trim() !== '') count += 1
    return count
}

export interface FilterContext {
    /** Who `ME` resolves to. '' for a visitor, whom `ME` then never matches. */
    userId: string
    now?: Date
}

/** AND across facets, OR within each. An empty facet constrains nothing. */
export function cardMatchesFilter(
    card: BoardCardView,
    filter: BoardFilter,
    ctx: FilterContext
): boolean {
    if (
        filter.labelIds.length > 0 &&
        !card.labels.some(label => filter.labelIds.includes(label.id))
    ) {
        return false
    }
    if (filter.assigneeIds.length > 0 && !matchesAssignees(card, filter.assigneeIds, ctx.userId)) {
        return false
    }
    if (filter.reporterIds.length > 0 && !matchesReporter(card, filter.reporterIds, ctx.userId)) {
        return false
    }
    if (filter.due !== null && !matchesDue(card, filter.due, ctx.now)) return false
    if (filter.priorities.length > 0 && !filter.priorities.includes(card.priority)) return false
    if (filter.estimate !== null && !matchesEstimate(card, filter.estimate)) return false
    if (filter.statuses.length > 0 && !filter.statuses.includes(card.listCategory)) return false
    if (!matchesKeyword(card, filter.text)) return false
    return true
}

function matchesAssignees(card: BoardCardView, wanted: string[], userId: string): boolean {
    return wanted.some(id => {
        if (id === UNASSIGNED) return card.assignees.length === 0
        const resolved = id === ME ? userId : id
        return resolved !== '' && card.assignees.some(member => member.id === resolved)
    })
}

function matchesReporter(card: BoardCardView, wanted: string[], userId: string): boolean {
    const reporterId = card.reporter?.id
    if (!reporterId) return false
    return wanted.some(id => {
        const resolved = id === ME ? userId : id
        return resolved !== '' && resolved === reporterId
    })
}

/**
 * A card in a done or canceled list is never overdue or due soon — finished
 * work is not late, which is also the rule the server's reminders follow.
 * `has` and `none` are about the date itself and ignore the list.
 */
function matchesDue(card: BoardCardView, due: DueFilter, now?: Date): boolean {
    switch (due) {
        case 'none':
            return card.due === undefined
        case 'has':
            return card.due !== undefined
        case 'overdue':
            return isOpenDue(card) && dueStateFor(card.due, now) === 'overdue'
        case 'soon':
            return isOpenDue(card) && dueStateFor(card.due, now) === 'soon'
    }
}

function isOpenDue(card: BoardCardView): card is BoardCardView & { due: Date } {
    return card.due !== undefined && !isClosedCategory(card.listCategory)
}

function matchesEstimate(card: BoardCardView, estimate: EstimateFilter): boolean {
    return estimate === 'estimated' ? card.estimate !== undefined : card.estimate === undefined
}

/**
 * Title-or-key substring match, case-insensitive. An empty or whitespace-only
 * query matches everything, so a filter bar with a cleared box constrains
 * nothing. Shared with the My cards search box.
 */
export function matchesKeyword(card: Pick<BoardCardView, 'title' | 'key'>, text: string): boolean {
    const needle = text.trim().toLowerCase()
    if (needle === '') return true
    return card.title.toLowerCase().includes(needle) || card.key.toLowerCase().includes(needle)
}
