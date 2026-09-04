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
 * The rollup a COLUMN HEADER shows: the total of the estimates on the cards it
 * lists, ignoring the unestimated ones.
 *
 * NO 1-point floor here, and the contrast with an epic's rollup
 * (server/epic_rollup.go's MAX(estimate, 1)) is deliberate rather than an
 * inconsistency. The two answer different questions:
 *
 *   - A column header is an OPT-IN badge. It renders only when the total is
 *     non-zero, so a board that never estimates shows nothing at all
 *     (EstimateTotal in BoardColumn.tsx). Flooring would make the total always
 *     non-zero and put a points badge on every board that has none today.
 *   - An epic's progress is a RATIO that must mean something on every board.
 *     "0 / 0 pts" would be useless on an unestimated board, so its floor lets
 *     the ratio read as a card count instead.
 *
 * A floor was briefly applied here so the two surfaces would agree about the
 * same cards. They do not need to: one is a sum a user opted into, the other a
 * denominator that has to exist. e2e (card-estimate.spec.ts) pins the header's
 * behaviour, including that an all-unestimated column shows no badge.
 */
export function sumEstimates(cards: Pick<BoardCardView, 'estimate'>[]): number {
    let total = 0
    for (const card of cards) total += card.estimate ?? 0
    return total
}

/** Both estimated — the sort has already sent the unestimated to the end. */
export function compareEstimate(a: number | undefined, b: number | undefined): number {
    return (a ?? 0) - (b ?? 0)
}
