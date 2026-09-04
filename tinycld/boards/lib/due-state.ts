export type DueState = 'overdue' | 'soon' | 'upcoming'

const DAY_MS = 86_400_000
/** Today and the next two days are "soon" — a 2-DAY window, counted in days. */
const SOON_WINDOW_DAYS = 2

/**
 * Compared DAY to day, never instant to instant — for a day-only due date.
 *
 * A due date names a calendar day (the picker writes `YYYY-MM-DD`; the parser
 * rebuilds it at LOCAL midnight), so the only correct question is which day it
 * falls on relative to today. Subtracting raw timestamps asked a different
 * one: midnight today is already in the past by 00:00:01, so a card due TODAY
 * rendered "· overdue" for all but the first second of the day — the state a
 * user is most likely to see, and wrong every time.
 *
 * A due date WITH a time (`hasTime`) is an instant, and "overdue" is the one
 * question an instant answers better than a day: 2:30 PM has passed at 2:31.
 * Everything else — soon, upcoming — stays on the day frame, so a card due
 * later today is "soon" exactly as a day-only card due today is.
 */
export function dueStateFor(due: Date, now: Date = new Date(), hasTime = false): DueState {
    if (hasTime && due.getTime() < now.getTime()) return 'overdue'
    const daysOut = Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY_MS)
    if (daysOut < 0) return 'overdue'
    if (daysOut <= SOON_WINDOW_DAYS) return 'soon'
    return 'upcoming'
}

/**
 * Local midnight on `date`'s calendar day. Rounding the difference above is
 * what keeps a DST boundary — where two local midnights are 23 or 25 hours
 * apart — from reading as a fractional day and truncating to the wrong one.
 */
function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function formatDueDate(date: Date, locale?: string): string {
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
}
