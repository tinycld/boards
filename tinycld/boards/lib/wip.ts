// WIP limits: how many cards belong in a column at once, and the one place the
// "0 means no limit" convention and the three states are written down.
//
// The schema (pb-migrations/1980000019) stores a plain non-negative integer,
// and PocketBase reads an omitted number back as 0. Rather than let every
// consumer test for 0, the boundary normalizes it to undefined here — the same
// shape lib/estimate.ts uses, so "unset" has exactly one representation on
// each side of the wire.
//
// NOTHING HERE ENFORCES ANYTHING. A limit colours a header; it never refuses a
// write. See the migration's comment for why blocking was rejected: the UI
// would refuse what the REST API allows, and a server guard would fail bulk
// moves and imports partway through.

/**
 * Where a column sits against its limit.
 *
 * `at` is its own state rather than being folded into `under`: a column resting
 * exactly on its limit is the moment a team wants to notice — one more card and
 * the flow is broken — so it gets its own colour rather than reading as healthy.
 */
export type WipState = 'under' | 'at' | 'over'

/** A stored value → the view's optional number. 0, NaN and negatives are "no limit". */
export function normalizeWipLimit(raw: number | undefined): number | undefined {
    if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return undefined
    return Math.floor(raw)
}

/**
 * The column's state, given how many cards it holds.
 *
 * `count` must be the column's TOTAL, never the filtered `cards.length`. A
 * limit that relaxes because someone narrowed the board would be worse than no
 * limit at all — see BoardColumn's WipBadge, which is the only caller.
 */
export function wipState(count: number, limit: number | undefined): WipState {
    if (limit === undefined) return 'under'
    if (count > limit) return 'over'
    if (count === limit) return 'at'
    return 'under'
}

/**
 * What the column header's count badge reads.
 *
 * Three shapes, in order of how much they have to say:
 *
 *   "7"      no limit, no filter
 *   "3/7"    a filter is hiding some of the column (shown/total)
 *   "7 / 3"  a limit is set (total/limit), spaced so it cannot be misread as
 *            the filter's ratio
 *
 * When BOTH a filter and a limit are on, the limit wins the badge and the
 * filter's ratio moves aside — the count that matters against a limit is the
 * one that is actually in the column.
 */
export function formatWipCount(shown: number, total: number, limit: number | undefined): string {
    if (limit !== undefined) return `${total} / ${limit}`
    if (shown === total) return String(total)
    return `${shown}/${total}`
}
