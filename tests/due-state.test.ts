import { describe, expect, it } from 'vitest'
import { dueStateFor, formatDueDate } from '../tinycld/cards/lib/due-state'

const NOW = new Date('2026-08-04T12:00:00Z')

describe('dueStateFor', () => {
    it('is overdue when the date has passed', () => {
        expect(dueStateFor(new Date('2026-08-01T12:00:00Z'), NOW)).toBe('overdue')
        expect(dueStateFor(new Date('2026-08-04T11:59:59Z'), NOW)).toBe('overdue')
    })

    it('is soon within the next two days', () => {
        expect(dueStateFor(new Date('2026-08-04T18:00:00Z'), NOW)).toBe('soon')
        expect(dueStateFor(new Date('2026-08-06T12:00:00Z'), NOW)).toBe('soon')
    })

    it('is upcoming beyond two days out', () => {
        expect(dueStateFor(new Date('2026-08-06T12:00:01Z'), NOW)).toBe('upcoming')
        expect(dueStateFor(new Date('2026-09-01T00:00:00Z'), NOW)).toBe('upcoming')
    })
})

describe('formatDueDate', () => {
    it('renders a short month and day', () => {
        // Local timezone may land this instant on Aug 4 or Aug 5.
        expect(formatDueDate(new Date('2026-08-04T12:00:00Z'), 'en-US')).toMatch(/^Aug [45]$/)
    })
})
