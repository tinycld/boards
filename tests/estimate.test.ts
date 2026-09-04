import { describe, expect, it } from 'vitest'
import {
    compareEstimate,
    ESTIMATE_PRESETS,
    formatEstimate,
    normalizeEstimate,
    sumEstimates,
} from '../tinycld/boards/lib/estimate'

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
    it('adds the estimated cards and ignores the rest', () => {
        expect(sumEstimates([{ estimate: 3 }, { estimate: undefined }, { estimate: 5 }])).toBe(8)
        expect(sumEstimates([])).toBe(0)
    })

    // The column header renders only when this is non-zero, so an
    // all-unestimated column shows no badge at all. An epic's rollup floors an
    // unestimated card at 1 point instead — a ratio needs a denominator, while
    // this badge is opt-in. See lib/estimate.ts for why they differ.
    it('is zero when nothing is estimated, so the header stays hidden', () => {
        expect(
            sumEstimates([
                { estimate: undefined },
                { estimate: undefined },
                { estimate: undefined },
            ])
        ).toBe(0)
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
