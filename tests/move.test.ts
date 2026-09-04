import { describe, expect, it } from 'vitest'
import {
    rankForAppend,
    rankForInsert,
    rankForPrepend,
    rankForReorder,
} from '../tinycld/cards/lib/move'
import { initialRanks } from '../tinycld/cards/lib/rank'

// Ranks are opaque strings (lib/rank.ts), so every assertion here is about
// ORDERING against the column's neighbours — never about the key's shape.

interface Card {
    id: string
    position: string
}

/** A column of `count` cards with ascending ranks, ids c0..cN. */
function column(count: number): Card[] {
    return initialRanks(count).map((position, i) => ({ id: `c${i}`, position }))
}

/**
 * Sort by `position, id` — the exact ordering the board renders with, and the
 * reason `id` is the tiebreaker: ranks are not unique.
 */
function byRank(a: Card, b: Card): number {
    if (a.position !== b.position) return a.position < b.position ? -1 : 1
    return a.id < b.id ? -1 : 1
}

/** The column as it renders after inserting `rank`: sorted by position, id. */
function afterInsert(cards: Card[], rank: string, id = 'new'): string[] {
    return [...cards, { id, position: rank }].sort(byRank).map(card => card.id)
}

describe('rankForAppend', () => {
    // Under a non-manual sort the column arrives out of rank order; append
    // must still land after the HIGHEST rank, not after whichever card
    // happened to render last.
    it('sorts after every existing card even when the input is unsorted', () => {
        const cards = column(3)
        const shuffled = [cards[2], cards[0], cards[1]].filter(c => c !== undefined)
        expect(afterInsert(cards, rankForAppend(shuffled))).toEqual(['c0', 'c1', 'c2', 'new'])
    })

    it('sorts after every existing card', () => {
        const cards = column(3)
        expect(afterInsert(cards, rankForAppend(cards))).toEqual(['c0', 'c1', 'c2', 'new'])
    })

    it('handles an empty column', () => {
        expect(afterInsert([], rankForAppend([]))).toEqual(['new'])
    })
})

describe('rankForPrepend', () => {
    it('sorts before every existing card', () => {
        const cards = column(3)
        expect(afterInsert(cards, rankForPrepend(cards))).toEqual(['new', 'c0', 'c1', 'c2'])
    })

    it('handles an empty column', () => {
        expect(afterInsert([], rankForPrepend([]))).toEqual(['new'])
    })
})

describe('rankForInsert', () => {
    it('lands at each interior index', () => {
        const cards = column(4)
        expect(afterInsert(cards, rankForInsert(cards, 1))).toEqual(['c0', 'new', 'c1', 'c2', 'c3'])
        expect(afterInsert(cards, rankForInsert(cards, 2))).toEqual(['c0', 'c1', 'new', 'c2', 'c3'])
        expect(afterInsert(cards, rankForInsert(cards, 3))).toEqual(['c0', 'c1', 'c2', 'new', 'c3'])
    })

    it('prepends at index 0 and appends at length', () => {
        const cards = column(3)
        expect(afterInsert(cards, rankForInsert(cards, 0))).toEqual(['new', 'c0', 'c1', 'c2'])
        expect(afterInsert(cards, rankForInsert(cards, 3))).toEqual(['c0', 'c1', 'c2', 'new'])
    })

    it('clamps an out-of-range index instead of throwing', () => {
        // A drop index computed from a gesture can overshoot by one; a thrown
        // error mid-drag is far worse than a clamp to the nearest end.
        const cards = column(2)
        expect(afterInsert(cards, rankForInsert(cards, 99))).toEqual(['c0', 'c1', 'new'])
        expect(afterInsert(cards, rankForInsert(cards, -5))).toEqual(['new', 'c0', 'c1'])
    })

    it('handles a single-card column from both sides', () => {
        const cards = column(1)
        expect(afterInsert(cards, rankForInsert(cards, 0))).toEqual(['new', 'c0'])
        expect(afterInsert(cards, rankForInsert(cards, 1))).toEqual(['c0', 'new'])
    })

    it('inserts into an empty column', () => {
        expect(afterInsert([], rankForInsert([], 0))).toEqual(['new'])
    })

    // The case that crashes a naive implementation. Ranks are not unique, and
    // rankBetween throws when its neighbours do not sort strictly apart, so
    // dropping between two tied cards must widen the window rather than fail.
    it('does not throw when the target gap is between two equal ranks', () => {
        const [first, tie, last] = initialRanks(3)
        const tied: Card[] = [
            { id: 'a', position: first },
            { id: 'b', position: tie },
            { id: 'c', position: tie },
            { id: 'd', position: last },
        ]
        expect(() => rankForInsert(tied, 2)).not.toThrow()
        // It lands somewhere inside the tied run — the run has no agreed order
        // to be precise about — but strictly before the next distinct rank.
        const rank = rankForInsert(tied, 2)
        expect(rank > first).toBe(true)
        expect(rank < last).toBe(true)
    })

    it('survives a run of three identical ranks', () => {
        const [low, high] = initialRanks(2)
        const tied: Card[] = [
            { id: 'a', position: low },
            { id: 'b', position: low },
            { id: 'c', position: low },
            { id: 'd', position: high },
        ]
        const rank = rankForInsert(tied, 3)
        expect(rank > low).toBe(true)
        expect(rank < high).toBe(true)
    })

    it('inserts before a leading run of duplicates', () => {
        // Every neighbour to the left is tied, so widening runs off the start
        // of the column and the card prepends rather than throwing.
        const [only] = initialRanks(1)
        const tied: Card[] = [
            { id: 'a', position: only },
            { id: 'b', position: only },
        ]
        const rank = rankForInsert(tied, 1)
        expect(rank < only).toBe(true)
    })
})

describe('rankForReorder', () => {
    it('excludes the moving card so a downward move is not off by one', () => {
        // Moving c0 to index 2 of the FINAL column puts it between c2 and c3.
        // Counting c0 itself would land it one slot too high.
        const cards = column(4)
        const rank = rankForReorder(cards, 'c0', 2)
        const moved = cards
            .map(card => (card.id === 'c0' ? { ...card, position: rank } : card))
            .sort(byRank)
        expect(moved.map(c => c.id)).toEqual(['c1', 'c2', 'c0', 'c3'])
    })

    it('moves a card to the top', () => {
        const cards = column(3)
        const rank = rankForReorder(cards, 'c2', 0)
        expect(rank < cards[0].position).toBe(true)
    })

    it('moves a card to the bottom', () => {
        const cards = column(3)
        const rank = rankForReorder(cards, 'c0', 3)
        expect(rank > cards[2].position).toBe(true)
    })

    it('is a no-op-shaped move when the index does not change', () => {
        // Dropping a card back where it started must still produce a rank that
        // keeps it in place, not one that jumps it a slot.
        const cards = column(3)
        const rank = rankForReorder(cards, 'c1', 1)
        expect(rank > cards[0].position).toBe(true)
        expect(rank < cards[2].position).toBe(true)
    })
})
