export type DueState = 'overdue' | 'soon' | 'upcoming'

const DAY_MS = 86_400_000
const SOON_WINDOW_MS = 2 * DAY_MS

export function dueStateFor(due: Date, now: Date = new Date()): DueState {
    const remaining = due.getTime() - now.getTime()
    if (remaining < 0) return 'overdue'
    if (remaining <= SOON_WINDOW_MS) return 'soon'
    return 'upcoming'
}

export function formatDueDate(date: Date, locale?: string): string {
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
}
