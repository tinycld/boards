import { describe, expect, it } from 'vitest'
import {
    comparePriority,
    isPriority,
    normalizePriority,
    PRIORITIES,
    priorityLabel,
    priorityRank,
} from '../tinycld/cards/lib/priority'

describe('priority scale', () => {
    it('orders urgent first and none last', () => {
        expect(PRIORITIES).toEqual(['urgent', 'high', 'medium', 'low', 'none'])
        expect(priorityRank('urgent')).toBeLessThan(priorityRank('high'))
        expect(priorityRank('low')).toBeLessThan(priorityRank('none'))
    })

    it('compares by scale position so an ascending sort puts urgent first', () => {
        const shuffled = ['low', 'urgent', 'none', 'medium', 'high'] as const
        expect([...shuffled].sort(comparePriority)).toEqual(PRIORITIES)
        expect(comparePriority('high', 'high')).toBe(0)
    })
})

describe('normalizePriority', () => {
    // PocketBase leaves an optional select as '' when the body omits it, and
    // rows written before the column existed carry '' too.
    it('reads an empty stored value as none', () => {
        expect(normalizePriority('')).toBe('none')
        expect(normalizePriority(undefined)).toBe('none')
    })

    it('passes a scale value through unchanged', () => {
        for (const priority of PRIORITIES) {
            expect(normalizePriority(priority)).toBe(priority)
        }
    })

    // The validator refuses these on write, so one can only arrive through a
    // schema edit — and a glyph for a value the scale does not define is the
    // wrong answer.
    it('collapses an unknown value to none', () => {
        expect(normalizePriority('critical')).toBe('none')
        expect(normalizePriority('HIGH')).toBe('none')
    })
})

describe('isPriority', () => {
    it('narrows exactly the scale', () => {
        expect(isPriority('urgent')).toBe(true)
        expect(isPriority('')).toBe(false)
        expect(isPriority('blocker')).toBe(false)
    })
})

describe('priorityLabel', () => {
    it('names none as the absence rather than a level', () => {
        expect(priorityLabel('none')).toBe('No priority')
        expect(priorityLabel('urgent')).toBe('Urgent')
    })
})
