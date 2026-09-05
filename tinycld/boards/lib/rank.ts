// Fractional ranks for ordering lists and cards.
//
// A rank is an opaque string that sorts lexicographically. Inserting between two
// neighbours produces a new string without touching either of them, so a move
// rewrites ONE row — which is what makes an optimistic drag safe. Renumbering
// integer positions would rewrite every sibling and let two concurrent moves
// clobber each other.
//
// The implementation is `fractional-indexing`, already present in the workspace
// as a TanStack DB dependency. This module exists to name the operations in
// boards' own terms and to keep the choice of implementation in one place — if
// this ever moves into core, callers do not change.
//
// TWO PROPERTIES CALLERS MUST KNOW:
//
// 1. RANKS ARE NOT UNIQUE. Two clients inserting into the same gap while offline
//    compute the same string, and there is deliberately no unique index on
//    `position` — a unique constraint would turn a harmless tie into a failed
//    optimistic insert. Every query ordering by rank must therefore sort
//    `ORDER BY position, id`: `id` is the stable tiebreaker that keeps a tie
//    rendering identically on every client instead of flickering between them.
//
// 2. THE KEY SPACE IS ASCII-ORDERED, not just digits — a rank may contain any of
//    0-9, A-Z, a-z, and its length varies. Never parse a rank, compare it
//    numerically, or assume a fixed width; only ever compare two ranks as
//    strings and hand them back to the functions below.
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

/** The rank of the first item in an empty list. */
export const FIRST_RANK = generateKeyBetween(null, null)

/**
 * A rank strictly between `before` and `after`.
 *
 * `before === null` means the start of the list, `after === null` the end; both
 * null yields {@link FIRST_RANK}. Throws when the two are equal or out of order,
 * which always means the caller passed unsorted or duplicate neighbours.
 *
 * The ordering check is OURS, not the library's, and it is deliberately
 * redundant with 3.x's own guard. 3.x throws on reversed arguments; 4.0.0
 * silently swaps them and returns a plausible-looking key instead
 * (`generateKeyBetween('a1', 'a0')` → `'a0V'`), which would land a card in the
 * wrong place with no error anywhere — the board just quietly reorders itself.
 * The peer range is pinned `<4` so that version cannot resolve, but a peer range
 * is a request, not an enforcement: it is satisfied by whatever the consuming
 * workspace hoists, and this repo does not own every install. Checking here
 * makes the guarantee independent of which version actually loaded.
 */
export function rankBetween(before: string | null, after: string | null): string {
    if (before !== null && after !== null && before >= after) {
        throw new Error(
            `rank: before must sort strictly before after (got '${before}', '${after}')`
        )
    }
    return generateKeyBetween(before, after)
}

/**
 * `count` ascending ranks — for seeding a board's lists or a card's checklist in
 * one pass, rather than calling {@link rankBetween} in a loop.
 */
export function initialRanks(count: number): string[] {
    if (!Number.isInteger(count) || count < 0) {
        throw new Error(`rank: count must be a non-negative integer (got ${count})`)
    }
    return generateNKeysBetween(null, null, count)
}

/**
 * `count` ascending ranks that all sort AFTER `highest`.
 *
 * A bulk move drops N cards into one column at once, and {@link rankBetween}
 * (or lib/move.ts's `rankForAppend`) called N times against unchanged state
 * returns the SAME string every time — every card would land on one rank and
 * their order would be decided by the `id` tiebreaker rather than by the order
 * the user selected them in.
 *
 * `highest` is the greatest rank already in the target column, or null for an
 * empty one. It is the greatest rather than the last element because under a
 * non-manual sort the caller's column is not in rank order — the same reason
 * `rankForAppend` scans for a maximum instead of reading `cards.at(-1)`.
 */
export function ranksAfter(highest: string | null, count: number): string[] {
    if (!Number.isInteger(count) || count < 0) {
        throw new Error(`rank: count must be a non-negative integer (got ${count})`)
    }
    return generateNKeysBetween(highest, null, count)
}
