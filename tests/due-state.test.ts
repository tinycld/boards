import { describe, expect, it } from 'vitest'
import { dueStateFor, formatDueDate } from '../tinycld/cards/lib/due-state'

// LOCAL noon, not a Z instant: a due date names a calendar day, and building
// the fixtures in UTC would make every case here depend on the runner's
// timezone (`new Date('2026-08-04T12:00:00Z')` is Aug 3 in UTC-13). Noon keeps
// each date unambiguously on its own day in any zone.
function localDay(year: number, month: number, day: number, hour = 12): Date {
    return new Date(year, month - 1, day, hour)
}

const NOW = localDay(2026, 8, 4)

describe('dueStateFor', () => {
    it('is overdue when the day has passed', () => {
        expect(dueStateFor(localDay(2026, 8, 1), NOW)).toBe('overdue')
        expect(dueStateFor(localDay(2026, 8, 3), NOW)).toBe('overdue')
    })

    // The regression this function was rewritten for. Due dates are stored as
    // a bare day and parsed to local MIDNIGHT, so an instant comparison put
    // every card due today in the past from 00:00:01 onward.
    it('is soon — not overdue — for a card due today', () => {
        expect(dueStateFor(localDay(2026, 8, 4, 0), NOW)).toBe('soon')
        expect(dueStateFor(localDay(2026, 8, 4, 23), NOW)).toBe('soon')
    })

    it('is soon within the next two days', () => {
        expect(dueStateFor(localDay(2026, 8, 5), NOW)).toBe('soon')
        expect(dueStateFor(localDay(2026, 8, 6), NOW)).toBe('soon')
    })

    it('is upcoming beyond two days out', () => {
        expect(dueStateFor(localDay(2026, 8, 7), NOW)).toBe('upcoming')
        expect(dueStateFor(localDay(2026, 9, 1), NOW)).toBe('upcoming')
    })

    // Time of day must not move a card between states — only the day does.
    it('ignores the time of day on either side', () => {
        expect(dueStateFor(localDay(2026, 8, 6, 0), localDay(2026, 8, 4, 23))).toBe('soon')
        expect(dueStateFor(localDay(2026, 8, 6, 23), localDay(2026, 8, 4, 0))).toBe('soon')
    })
})

describe('formatDueDate', () => {
    it('renders a short month and day', () => {
        expect(formatDueDate(localDay(2026, 8, 4), 'en-US')).toBe('Aug 4')
    })
})
