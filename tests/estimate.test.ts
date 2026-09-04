import { describe, expect, it } from 'vitest'
import {
    compareEstimate,
    ESTIMATE_PRESETS,
    formatEstimate,
    normalizeEstimate,
    sumEstimates,
} from '../tinycld/cards/lib/estimate'

describe('normalizeEstimate', () => {
    it('maps the stored zero, and anything unusable, to unset', () => {
        expect(normalizeEstimate(0)).toBeUndefined()
        expect(normalizeEstimate(undefined)).toBeUndefined()
        expect(normalizeEstimate(-3)).toBeUndefined()
        expect(normalizeEstimate(Number.NaN)).toBeUndefined()
    })

    it('keeps a positive integer and floors a fraction', () => {
        expect(normalizeEstimate(5)).toBe(5)
        expect(normalizeEstimate(2.7)).toBe(2)
    })
})

describe('formatEstimate', () => {
    it('pluralizes', () => {
        expect(formatEstimate(1)).toBe('1 pt')
        expect(formatEstimate(8)).toBe('8 pts')
    })
})

describe('sumEstimates', () => {
    it('adds the estimates, counting an unestimated card as one point', () => {
        expect(sumEstimates([{ estimate: 3 }, { estimate: undefined }, { estimate: 5 }])).toBe(9)
        expect(sumEstimates([])).toBe(0)
    })

    // The floor is what makes the number meaningful on a board that never
    // estimates — where summing raw estimates would read 0 for real work.
    // Mirrored by MAX(estimate, 1) in server/epic_rollup.go, so a column
    // header and an epic never disagree about the same cards.
    it('reads as a card count when nothing is estimated', () => {
        expect(
            sumEstimates([
                { estimate: undefined },
                { estimate: undefined },
                { estimate: undefined },
            ])
        ).toBe(3)
    })
})

describe('compareEstimate', () => {
    it('orders ascending by points', () => {
        expect(compareEstimate(3, 5)).toBeLessThan(0)
        expect(compareEstimate(5, 3)).toBeGreaterThan(0)
        expect(compareEstimate(5, 5)).toBe(0)
    })
})

describe('ESTIMATE_PRESETS', () => {
    it('is the ascending ladder the picker offers', () => {
        expect([...ESTIMATE_PRESETS]).toEqual([1, 2, 3, 5, 8, 13])
    })
})
