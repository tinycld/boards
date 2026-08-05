import { describe, expect, it } from 'vitest'
import { FIRST_RANK, initialRanks, rankBetween } from '../tinycld/cards/lib/rank'

// A rank is opaque: any ASCII-ordered key of unbounded-but-short length. These
// tests assert the ORDERING CONTRACT the board depends on, never the shape of
// the keys themselves.
const fitsColumn = (rank: string) => rank.length > 0 && rank.length <= 64

describe('rankBetween', () => {
    it('returns the first rank for an empty list', () => {
        expect(rankBetween(null, null)).toBe(FIRST_RANK)
    })

    it('prepends before the first rank', () => {
        expect(rankBetween(null, FIRST_RANK) < FIRST_RANK).toBe(true)
    })

    it('appends after the last rank', () => {
        expect(rankBetween(FIRST_RANK, null) > FIRST_RANK).toBe(true)
    })

    it('lands strictly between two neighbours', () => {
        const a = FIRST_RANK
        const b = rankBetween(a, null)
        const middle = rankBetween(a, b)
        expect(a < middle).toBe(true)
        expect(middle < b).toBe(true)
    })

    it('keeps finding room when repeatedly inserting into the same gap', () => {
        // The pathological case for any fractional scheme: always split the same
        // interval. Keys lengthen, but ordering must never break.
        let low = FIRST_RANK
        const high = rankBetween(low, null)
        for (let i = 0; i < 100; i += 1) {
            const next = rankBetween(low, high)
            expect(low < next).toBe(true)
            expect(next < high).toBe(true)
            expect(fitsColumn(next)).toBe(true)
            low = next
        }
    })

    it('stays within the position column when repeatedly prepending', () => {
        // Prepending is a real user action (drag to top), so it must not grow
        // keys without bound the way a naive midpoint scheme does.
        let ranks = [FIRST_RANK]
        for (let i = 0; i < 500; i += 1) {
            ranks = [rankBetween(null, ranks[0]), ...ranks]
        }
        for (let i = 1; i < ranks.length; i += 1) {
            expect(ranks[i - 1] < ranks[i]).toBe(true)
        }
        for (const rank of ranks) {
            expect(fitsColumn(rank)).toBe(true)
        }
    })

    it('rejects neighbours that are equal or out of order', () => {
        // Asserts OUR message, not merely that something threw: 3.x throws here
        // but 4.0.0 silently returns a plausible-looking key, so a bare
        // .toThrow() would pass or fail depending on which version resolved.
        // The peer range pins `<4`, and rank.ts guards anyway — this assertion
        // is what proves the guard, rather than the library, is doing the work.
        const a = FIRST_RANK
        const b = rankBetween(a, null)
        expect(() => rankBetween(b, a)).toThrow(/strictly before/)
        expect(() => rankBetween(a, a)).toThrow(/strictly before/)
    })

    it('preserves order across many insertions at varying positions', () => {
        let ranks = initialRanks(5)
        for (let i = 0; i < 1000; i += 1) {
            // Deterministic but scattered gap choice — no Math.random, so a
            // failure reproduces exactly.
            const gap = (i * 7919) % (ranks.length + 1)
            const before = gap === 0 ? null : ranks[gap - 1]
            const after = gap === ranks.length ? null : ranks[gap]
            ranks = [...ranks.slice(0, gap), rankBetween(before, after), ...ranks.slice(gap)]
        }

        expect(ranks).toHaveLength(1005)
        for (let i = 1; i < ranks.length; i += 1) {
            expect(ranks[i - 1] < ranks[i]).toBe(true)
        }
        for (const rank of ranks) {
            expect(fitsColumn(rank)).toBe(true)
        }
    })
})

describe('initialRanks', () => {
    it('returns nothing for a count of zero', () => {
        expect(initialRanks(0)).toEqual([])
    })

    it('returns strictly ascending ranks that fit the column', () => {
        const ranks = initialRanks(25)
        expect(ranks).toHaveLength(25)
        for (let i = 1; i < ranks.length; i += 1) {
            expect(ranks[i - 1] < ranks[i]).toBe(true)
        }
        for (const rank of ranks) {
            expect(fitsColumn(rank)).toBe(true)
        }
    })

    it('agrees with rankBetween for a single item', () => {
        expect(initialRanks(1)).toEqual([FIRST_RANK])
    })

    it('rejects a negative or fractional count', () => {
        expect(() => initialRanks(-1)).toThrow(/non-negative integer/)
        expect(() => initialRanks(1.5)).toThrow(/non-negative integer/)
    })
})
