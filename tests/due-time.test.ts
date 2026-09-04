import { describe, expect, it } from 'vitest'
import {
    encodeDue,
    formatDueTime,
    formatSchedule,
    parseDayValue,
    parseDueValue,
    parseTimeText,
    timeOf,
} from '../tinycld/cards/lib/due-time'

describe('parseDayValue', () => {
    it('rebuilds the stored day at local midnight in either spelling', () => {
        for (const value of ['2026-09-04', '2026-09-04 00:00:00.000Z']) {
            const day = parseDayValue(value)
            expect(day && [day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2026, 8, 4])
            expect(day?.getHours()).toBe(0)
        }
    })

    it('is undefined for empty or unparseable values', () => {
        expect(parseDayValue('')).toBeUndefined()
        expect(parseDayValue('not-a-date')).toBeUndefined()
    })
})

describe('parseDueValue', () => {
    it('reads a timed value as the instant it is, and a day value as a day', () => {
        const instant = new Date(2026, 8, 4, 14, 30)
        const timed = parseDueValue(instant.toISOString(), true)
        expect(timed?.getTime()).toBe(instant.getTime())
        expect(parseDueValue('2026-09-04 00:00:00.000Z', false)?.getDate()).toBe(4)
    })
})

describe('encodeDue', () => {
    it('writes a bare day without a time', () => {
        expect(encodeDue(new Date(2026, 8, 4, 17), null)).toEqual({
            due: '2026-09-04',
            due_has_time: false,
        })
    })

    it('writes an instant with the flag, round-tripping the local time', () => {
        const encoded = encodeDue(new Date(2026, 8, 4), { hours: 14, minutes: 30 })
        expect(encoded.due_has_time).toBe(true)
        const back = parseDueValue(encoded.due, true)
        expect(back && timeOf(back)).toEqual({ hours: 14, minutes: 30 })
        expect(back?.getDate()).toBe(4)
    })
})

describe('parseTimeText', () => {
    it('accepts the ways people type a time', () => {
        expect(parseTimeText('14:30')).toEqual({ hours: 14, minutes: 30 })
        expect(parseTimeText('2:30 pm')).toEqual({ hours: 14, minutes: 30 })
        expect(parseTimeText('9am')).toEqual({ hours: 9, minutes: 0 })
        expect(parseTimeText('12 am')).toEqual({ hours: 0, minutes: 0 })
        expect(parseTimeText('12pm')).toEqual({ hours: 12, minutes: 0 })
        expect(parseTimeText(' 17 ')).toEqual({ hours: 17, minutes: 0 })
        expect(parseTimeText('17.05')).toEqual({ hours: 17, minutes: 5 })
    })

    it('rejects what is not a time', () => {
        expect(parseTimeText('')).toBeNull()
        expect(parseTimeText('25:00')).toBeNull()
        expect(parseTimeText('9:60')).toBeNull()
        expect(parseTimeText('13 pm')).toBeNull()
        expect(parseTimeText('noon')).toBeNull()
    })
})

describe('formatSchedule', () => {
    const start = new Date(2026, 8, 3)
    const due = new Date(2026, 8, 10, 14, 30)

    it('renders every combination', () => {
        expect(formatSchedule(start, due, false, 'en-US')).toBe('Sep 3 → Sep 10')
        expect(formatSchedule(start, due, true, 'en-US')).toBe('Sep 3 → Sep 10, 2:30 PM')
        expect(formatSchedule(undefined, due, true, 'en-US')).toBe('Sep 10, 2:30 PM')
        expect(formatSchedule(undefined, due, false, 'en-US')).toBe('Sep 10')
        expect(formatSchedule(start, undefined, false, 'en-US')).toBe('Sep 3 →')
        expect(formatSchedule(undefined, undefined, false, 'en-US')).toBe('')
    })

    it('formats a time in the locale', () => {
        expect(formatDueTime(due, 'en-US')).toBe('2:30 PM')
    })
})
