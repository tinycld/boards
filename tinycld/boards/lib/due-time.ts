// Dates on a card: the two stored shapes, and every conversion between them
// and what the UI shows.
//
// A DAY value (`start`, and `due` when `due_has_time` is false) is stored as
// a bare 'YYYY-MM-DD' that PocketBase normalizes to 'YYYY-MM-DD 00:00:00.000Z'.
// It names a calendar day, the same day for everyone, and is rebuilt at LOCAL
// midnight from the UTC parts — `new Date` on either spelling lands at UTC
// midnight, which is the previous day west of Greenwich. A TIMED value (`due`
// when the flag is set) is a real instant and is parsed as one. The two paths
// must never be mixed: the UTC-parts rebuild applied to an instant shifts it
// by the zone offset.
//
// Boards-local rather than in core's lib/dates, whose contract is day-only by
// design; promote when a second package needs a time.

import { toDateString } from '@tinycld/core/lib/dates'
import { formatDueDate } from './due-state'

export interface DueTime {
    hours: number
    minutes: number
}

/** A stored day value → the local calendar day, or undefined when unset. */
export function parseDayValue(value: string): Date | undefined {
    if (value === '') return undefined
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return undefined
    return new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
}

/** A stored due value → a Date in the frame the flag says it is in. */
export function parseDueValue(value: string, hasTime: boolean): Date | undefined {
    if (!hasTime) return parseDayValue(value)
    if (value === '') return undefined
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

/** What the picker writes: a bare day, or an instant with the flag set. */
export function encodeDue(day: Date, time: DueTime | null): { due: string; due_has_time: boolean } {
    if (!time) return { due: toDateString(day), due_has_time: false }
    const instant = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        time.hours,
        time.minutes
    )
    return { due: instant.toISOString(), due_has_time: true }
}

export function timeOf(date: Date): DueTime {
    return { hours: date.getHours(), minutes: date.getMinutes() }
}

/**
 * '14:30', '2:30 pm', '9', '9am', '17.00' → a time, or null when it is not
 * one. Lenient on purpose: the field is typed into, and "17" meaning 17:00
 * is what people mean.
 */
export function parseTimeText(text: string): DueTime | null {
    const match = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*$/i.exec(text)
    if (!match) return null
    let hours = Number(match[1])
    const minutes = match[2] ? Number(match[2]) : 0
    const meridiem = match[3]?.toLowerCase()
    if (minutes > 59) return null
    if (meridiem) {
        if (hours < 1 || hours > 12) return null
        if (meridiem === 'pm' && hours < 12) hours += 12
        if (meridiem === 'am' && hours === 12) hours = 0
    } else if (hours > 23) {
        return null
    }
    return { hours, minutes }
}

export function formatDueTime(date: Date, locale?: string): string {
    return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
}

/**
 * The one line a face or chip shows: "Sep 3 → Sep 10", "Sep 10, 2:30 PM",
 * "Sep 3 →" for a start with no deadline, '' for neither.
 */
export function formatSchedule(
    start: Date | undefined,
    due: Date | undefined,
    dueHasTime: boolean,
    locale?: string
): string {
    const dueLabel = due
        ? dueHasTime
            ? `${formatDueDate(due, locale)}, ${formatDueTime(due, locale)}`
            : formatDueDate(due, locale)
        : ''
    if (start && due) return `${formatDueDate(start, locale)} → ${dueLabel}`
    if (start) return `${formatDueDate(start, locale)} →`
    return dueLabel
}
