// Estimates: what a card is worth in points, and the one place the preset
// scale and the "0 means unset" convention are written down.
//
// The schema (pb-migrations/1980000010) stores a plain non-negative integer,
// and PocketBase reads an omitted number back as 0 rather than null. Rather
// than let every consumer test for 0, the boundary normalizes it to undefined
// here, and the mutation writes 0 to clear — so "no estimate" has exactly one
// representation on each side of the wire.

import type { BoardCardView } from '../types'

/**
 * The picker's choices. A Fibonacci-ish ladder because that is what Jira and
 * Linear offer by default, and because coarse steps discourage the false
 * precision that a free number invites. The schema is not limited to these —
 * the CLI and rules can write any integer up to the column's max.
 */
export const ESTIMATE_PRESETS = [1, 2, 3, 5, 8, 13] as const

/** A stored value → the view's optional number. 0, NaN and negatives are "unset". */
export function normalizeEstimate(raw: number | undefined): number | undefined {
    if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return undefined
    return Math.floor(raw)
}

export function formatEstimate(points: number): string {
    return points === 1 ? '1 pt' : `${points} pts`
}

/** The rollup a column header shows: the total of the cards it lists. */
export function sumEstimates(cards: Pick<BoardCardView, 'estimate'>[]): number {
    let total = 0
    for (const card of cards) total += card.estimate ?? 0
    return total
}

/** Both estimated — the sort has already sent the unestimated to the end. */
export function compareEstimate(a: number | undefined, b: number | undefined): number {
    return (a ?? 0) - (b ?? 0)
}
