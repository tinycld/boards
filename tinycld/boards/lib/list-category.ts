// The list status scale, and the one place its vocabulary and meaning live.
//
// The schema (pb-migrations/1980000011) fixes the values; this module fixes
// what they mean — which ones count as "closed", what each is called — so a
// change is one edit rather than a hunt through every glyph and filter.

export const LIST_CATEGORIES = ['backlog', 'todo', 'in_progress', 'done', 'canceled'] as const

export type ListCategory = (typeof LIST_CATEGORIES)[number]

/**
 * A stored value → a category.
 *
 * PocketBase leaves an optional select as '' when an insert omits it, and a
 * list written before the column existed carries '' too. Both mean an
 * ordinary working list, which is `todo`. An unknown string can only arrive
 * through a schema edit and lands there as well.
 */
export function normalizeListCategory(raw: string | undefined): ListCategory {
    return isListCategory(raw ?? '') ? (raw as ListCategory) : 'todo'
}

export function isListCategory(raw: string): raw is ListCategory {
    return LIST_CATEGORIES.includes(raw as ListCategory)
}

/**
 * Work in a closed list is finished, one way or the other: it gets no due
 * reminders, is never "overdue", and drops out of My cards by default.
 */
export function isClosedCategory(category: ListCategory): boolean {
    return category === 'done' || category === 'canceled'
}

const LABELS: Record<ListCategory, string> = {
    backlog: 'Backlog',
    todo: 'To do',
    in_progress: 'In progress',
    done: 'Done',
    canceled: 'Canceled',
}

export function categoryLabel(category: ListCategory): string {
    return LABELS[category]
}
