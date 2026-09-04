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

/**
 * The rollup a column header and an epic show: the points of the cards listed,
 * counting an UNESTIMATED card as 1.
 *
 * The floor is what makes one number correct on both kinds of board. Summing
 * raw estimates reads "0 pts" on the many boards that never estimate — the
 * ones the `unestimated` facet exists to acknowledge — while counting cards
 * throws away the sizing an estimating board did. Treating an unsized card as
 * the smallest unit of work says something true on either.
 *
 * The server applies the same floor in SQL (server/epic_rollup.go's
 * MAX(estimate, 1)), and the agreement is the point: a column header and an
 * epic that disagreed about one set of cards would be the kind of bug nobody
 * files and everybody distrusts.
 *
 * This CHANGED the shipped column total — an all-unestimated column read
 * "0 pts" before and reads its card count now — taken deliberately, because a
 * column holding eight cards is not worth zero. The `estimated`/`unestimated`
 * FILTER is untouched: "did someone size this card" is still a real question,
 * and a different one from "what is it worth".
 */
export function sumEstimates(cards: Pick<BoardCardView, 'estimate'>[]): number {
    let total = 0
    for (const card of cards) total += Math.max(card.estimate ?? 0, 1)
    return total
}

/** Both estimated — the sort has already sent the unestimated to the end. */
export function compareEstimate(a: number | undefined, b: number | undefined): number {
    return (a ?? 0) - (b ?? 0)
}
