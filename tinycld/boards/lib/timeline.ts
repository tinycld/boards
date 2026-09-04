// The timeline view's model: a day axis, and one row per scheduled card,
// grouped by list — everything the renderer positions, computed once.
//
// Pure, on the board tree, so the range arithmetic and the grouping are
// tested without React and the components only draw. Columns are DAYS,
// indexed from the range's first day; a column index is always computed by
// rounding the distance between two LOCAL midnights, never by dividing, so a
// DST day (23 or 25 hours) still lands on its own column.

import type { BoardCardView, BoardListView, BoardProject } from '../types'
import { type BoardSort, compareCards } from './board-sort'
import { type DueState, dueStateFor } from './due-state'

const DAY_MS = 86_400_000
/** Days of air on either side of the scheduled span. */
const PADDING_DAYS = 7
/** A floor so a board with one dated card still scrolls like a timeline. */
const MIN_DAYS = 56

export interface TimelineRange {
    /** Local midnight of the first column. */
    start: Date
    days: number
}

export interface TimelineRow {
    card: BoardCardView
    /** A bar from start to due, or a single-day marker for one date alone. */
    kind: 'span' | 'point'
    startCol: number
    endCol: number
    /** Colour cue for the bar's end; absent when the card has no due date. */
    dueState?: DueState
}

export interface TimelineGroup {
    list: BoardListView
    rows: TimelineRow[]
}

export interface Timeline {
    range: TimelineRange
    groups: TimelineGroup[]
    /** Every drawn card, top to bottom — what j/k walk. */
    visibleOrder: string[]
    todayCol: number
}

export interface DayColumn {
    date: Date
    /** The day of the month. */
    label: string
    isToday: boolean
    isWeekend: boolean
    /** Set on the first column of each month (and the first column overall). */
    monthLabel?: string
}

export function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function dayIndex(rangeStart: Date, date: Date): number {
    return Math.round((startOfDay(date).getTime() - rangeStart.getTime()) / DAY_MS)
}

function addDays(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function isScheduled(card: BoardCardView): boolean {
    return card.start !== undefined || card.due !== undefined
}

/**
 * The window: every scheduled date and today, padded, and at least MIN_DAYS
 * wide. Today is always inside, so the view has a "now" to open on even when
 * every card is far in the past or future.
 */
export function timelineRange(project: BoardProject, today: Date): TimelineRange {
    let min = startOfDay(today)
    let max = min
    for (const list of project.lists) {
        for (const card of list.cards) {
            for (const date of [card.start, card.due]) {
                if (!date) continue
                const day = startOfDay(date)
                if (day < min) min = day
                if (day > max) max = day
            }
        }
    }
    const start = addDays(min, -PADDING_DAYS)
    const days = Math.max(MIN_DAYS, dayIndex(start, addDays(max, PADDING_DAYS)) + 1)
    return { start, days }
}

export function buildTimeline(project: BoardProject, sort: BoardSort, today: Date): Timeline {
    const range = timelineRange(project, today)
    const compare = compareCards(sort)
    const groups: TimelineGroup[] = []
    const visibleOrder: string[] = []
    for (const list of project.lists) {
        const scheduled = list.cards.filter(isScheduled).sort(compare)
        if (scheduled.length === 0) continue
        const rows = scheduled.map(card => toRow(card, range, today))
        groups.push({ list, rows })
        for (const row of rows) visibleOrder.push(row.card.id)
    }
    return { range, groups, visibleOrder, todayCol: dayIndex(range.start, today) }
}

function toRow(card: BoardCardView, range: TimelineRange, today: Date): TimelineRow {
    const dueState = card.due ? dueStateFor(card.due, today, card.dueHasTime) : undefined
    if (card.start && card.due) {
        const endCol = dayIndex(range.start, card.due)
        // A start after the due date is a data error, not a negative-width
        // bar: draw the day the card is due and let the chip say the rest.
        const startCol = Math.min(dayIndex(range.start, card.start), endCol)
        return { card, kind: 'span', startCol, endCol, dueState }
    }
    const date = card.due ?? card.start
    if (!date) throw new Error('toRow called for an unscheduled card')
    const col = dayIndex(range.start, date)
    return { card, kind: 'point', startCol: col, endCol: col, dueState }
}

export function dayColumns(range: TimelineRange, today: Date = new Date()): DayColumn[] {
    const todayCol = dayIndex(range.start, today)
    const columns: DayColumn[] = []
    for (let i = 0; i < range.days; i++) {
        const date = addDays(range.start, i)
        const weekday = date.getDay()
        const isMonthStart = i === 0 || date.getDate() === 1
        columns.push({
            date,
            label: String(date.getDate()),
            isToday: i === todayCol,
            isWeekend: weekday === 0 || weekday === 6,
            monthLabel: isMonthStart
                ? date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
                : undefined,
        })
    }
    return columns
}
