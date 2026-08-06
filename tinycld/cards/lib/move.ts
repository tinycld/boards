// Where a card lands: rank arithmetic against an already-sorted column.
//
// Kept pure and outside the mutation hook so the placement logic can be tested
// without React or a database — a wrong rank is invisible until two cards
// render in the wrong order, which is exactly the kind of bug a unit test
// catches and a manual click-through does not.
//
// Every function here takes the column's cards ALREADY SORTED by `position, id`
// (which is what `buildBoardProject` hands back) and returns a single rank
// string. A move is then one field update — see lib/rank.ts for why that
// matters.
import { rankBetween } from './rank'

/** The subset of a card these functions order by. */
interface Ranked {
    id: string
    position: string
}

/**
 * Neighbour ranks are only usable when they sort strictly apart.
 *
 * Ranks are NOT unique (lib/rank.ts): two clients splitting the same gap while
 * offline compute the same string, and nothing in the schema prevents it. When
 * that tie is exactly the gap being inserted into, `rankBetween` throws rather
 * than return a key that cannot sort between them.
 *
 * Widening the window is the fix: skip past the duplicates to the nearest rank
 * that genuinely differs. The card lands within the tied run rather than at a
 * mathematically exact index, which is the correct trade — the tied run has no
 * agreed order to be exact about, and the alternative is a crash on a drag.
 */
function widenBefore(cards: Ranked[], index: number, after: string | null): string | null {
    for (let i = index; i >= 0; i -= 1) {
        const candidate = cards[i]?.position
        if (candidate === undefined) continue
        if (after === null || candidate < after) return candidate
    }
    return null
}

/** The rank for a card appended to the end of `cards`. */
export function rankForAppend(cards: Ranked[]): string {
    const last = cards[cards.length - 1]
    return rankBetween(last?.position ?? null, null)
}

/** The rank for a card placed at the start of `cards`. */
export function rankForPrepend(cards: Ranked[]): string {
    const first = cards[0]
    return rankBetween(null, first?.position ?? null)
}

/**
 * The rank for a card inserted so it comes to rest at `index`.
 *
 * `index` is a position in the FINAL column, so 0 prepends and
 * `cards.length` appends. Out-of-range values clamp rather than throw: a drop
 * target computed from a gesture can legitimately overshoot by one.
 *
 * `cards` must NOT contain the card being moved — a within-column move has to
 * remove it first, or it becomes its own neighbour and the rank it computes is
 * the one it already has.
 */
export function rankForInsert(cards: Ranked[], index: number): string {
    const clamped = Math.max(0, Math.min(index, cards.length))
    if (clamped === 0) return rankForPrepend(cards)
    if (clamped >= cards.length) return rankForAppend(cards)

    const after = cards[clamped]?.position ?? null
    const before = widenBefore(cards, clamped - 1, after)
    return rankBetween(before, after)
}

/**
 * The rank for moving `cardId` to `index` within a column that still contains
 * it — the within-column reorder case.
 *
 * Dropping a card two slots down means index 2 in the list WITHOUT it, not with
 * it. Callers that pass the raw board column would otherwise be off by one for
 * every downward move, and would compute the card's own current rank for a
 * no-op move.
 */
export function rankForReorder(cards: Ranked[], cardId: string, index: number): string {
    const without = cards.filter(card => card.id !== cardId)
    return rankForInsert(without, index)
}
