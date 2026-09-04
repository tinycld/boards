// The priority scale, and the one place its ORDER is defined.
//
// The schema (pb-migrations/1980000006) fixes the vocabulary; this module fixes
// what the words mean relative to each other, which a select field cannot say.
// Every sort, every glyph and every "is this urgent" check reads the order from
// here so that a reordering is one edit, not a hunt.

export const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const

export type CardPriority = (typeof PRIORITIES)[number]

/**
 * Lower is more urgent, so `urgent` sorts first in an ascending sort — the
 * default direction a "sort by priority" control wants.
 */
export function priorityRank(priority: CardPriority): number {
    return PRIORITIES.indexOf(priority)
}

export function comparePriority(a: CardPriority, b: CardPriority): number {
    return priorityRank(a) - priorityRank(b)
}

/**
 * A stored value → a priority.
 *
 * PocketBase leaves an optional select as '' when an insert omits it, and a
 * row written by a client that predates the field carries '' too. Both mean
 * "no priority", exactly as `none` does, so they collapse here rather than
 * leaking a third state into every consumer. An unknown string — which the
 * validator refuses on write, so it can only arrive through a schema edit —
 * lands on `none` as well: rendering nothing beats rendering a glyph for a
 * value the scale does not define.
 */
export function normalizePriority(raw: string | undefined): CardPriority {
    return PRIORITIES.includes(raw as CardPriority) ? (raw as CardPriority) : 'none'
}

export function isPriority(raw: string): raw is CardPriority {
    return PRIORITIES.includes(raw as CardPriority)
}

const LABELS: Record<CardPriority, string> = {
    urgent: 'Urgent',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    none: 'No priority',
}

export function priorityLabel(priority: CardPriority): string {
    return LABELS[priority]
}
