import { describe, expect, it } from 'vitest'
import { formatWipCount, normalizeWipLimit, wipState } from '../tinycld/boards/lib/wip'

// The WIP limit's contract: 0 is "no limit" on the wire and `undefined` in the
// view, a column resting exactly on its limit is its OWN state, and the badge
// says which of the three things it is looking at.
//
// Nothing here asserts enforcement, because there is none by design — see
// lib/wip.ts and pb-migrations/1980000019.

describe('normalizeWipLimit', () => {
    it('reads the stored 0 as no limit', () => {
        expect(normalizeWipLimit(0)).toBeUndefined()
    })

    it('passes a real limit through', () => {
        expect(normalizeWipLimit(3)).toBe(3)
        expect(normalizeWipLimit(1)).toBe(1)
    })

    it('treats an absent, negative or non-finite value as no limit', () => {
        expect(normalizeWipLimit(undefined)).toBeUndefined()
        expect(normalizeWipLimit(-2)).toBeUndefined()
        expect(normalizeWipLimit(Number.NaN)).toBeUndefined()
        expect(normalizeWipLimit(Number.POSITIVE_INFINITY)).toBeUndefined()
    })

    it('floors a fractional value rather than rendering "2.5"', () => {
        expect(normalizeWipLimit(2.7)).toBe(2)
    })
})

describe('wipState', () => {
    it('is under while the column has room', () => {
        expect(wipState(0, 3)).toBe('under')
        expect(wipState(2, 3)).toBe('under')
    })

    // The boundary the whole type exists for: full is not the same as healthy.
    it('is `at` exactly on the limit, not `under`', () => {
        expect(wipState(3, 3)).toBe('at')
    })

    it('is over past the limit', () => {
        expect(wipState(4, 3)).toBe('over')
        expect(wipState(30, 3)).toBe('over')
    })

    it('is always under when no limit is set', () => {
        expect(wipState(0, undefined)).toBe('under')
        expect(wipState(99, undefined)).toBe('under')
    })

    // A limit of 1 is a real setting (a single-card "in review" column), so the
    // first card must already read as `at`.
    it('handles a limit of one', () => {
        expect(wipState(0, 1)).toBe('under')
        expect(wipState(1, 1)).toBe('at')
        expect(wipState(2, 1)).toBe('over')
    })
})

describe('formatWipCount', () => {
    it('is the bare total with no limit and no filter', () => {
        expect(formatWipCount(7, 7, undefined)).toBe('7')
    })

    it('is shown/total while a filter hides part of the column', () => {
        expect(formatWipCount(3, 7, undefined)).toBe('3/7')
    })

    it('is total / limit once a limit is set', () => {
        expect(formatWipCount(7, 7, 3)).toBe('7 / 3')
    })

    // The case that decides the whole design: a filter must never make a column
    // look like it is within its limit. The badge reads against the TOTAL.
    it('keeps reading against the total when a filter is also on', () => {
        expect(formatWipCount(1, 7, 3)).toBe('7 / 3')
    })
})
