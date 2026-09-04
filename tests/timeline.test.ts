import { describe, expect, it } from 'vitest'
import { MANUAL_SORT } from '../tinycld/cards/lib/board-sort'
import { buildTimeline, dayColumns, dayIndex, timelineRange } from '../tinycld/cards/lib/timeline'
import type { BoardCardView, BoardListView, BoardProject } from '../tinycld/cards/types'

const TODAY = new Date(2026, 8, 4, 12)
const day = (offset: number) => new Date(2026, 8, 4 + offset)

function card(id: string, overrides: Partial<BoardCardView> = {}): BoardCardView {
    return {
        id,
        key: '',
        listId: 'l1',
        position: id,
        title: id,
        description: '',
        due: undefined,
        dueHasTime: false,
        labels: [],
        assignees: [],
        reporter: undefined,
        priority: 'none',
        listCategory: 'todo',
        created: '',
        checklistTotal: 0,
        checklistDone: 0,
        commentCount: 0,
        attachmentCount: 0,
        ...overrides,
    }
}

function list(id: string, cards: BoardCardView[]): BoardListView {
    return { id, name: id, position: id, category: 'todo', cards, totalCount: cards.length }
}

function project(lists: BoardListView[]): BoardProject {
    return {
        id: 'p1',
        name: 'Board',
        slug: '',
        color: '#000',
        autoArchiveDays: 0,
        members: [],
        labels: [],
        lists,
        listOrder: lists.map(l => ({ id: l.id, position: l.position })),
        cardTotal: lists.reduce((n, l) => n + l.cards.length, 0),
        unplacedCards: [],
    }
}

describe('timelineRange', () => {
    it('pads the scheduled span, always includes today, and floors the width', () => {
        const range = timelineRange(project([list('l1', [card('a', { due: day(3) })])]), TODAY)
        expect(dayIndex(range.start, TODAY)).toBe(7)
        expect(range.days).toBe(56)
    })

    it('grows past the floor for a long span', () => {
        const range = timelineRange(
            project([list('l1', [card('a', { start: day(-40), due: day(60) })])]),
            TODAY
        )
        expect(dayIndex(range.start, day(-40))).toBe(7)
        expect(range.days).toBe(7 + 100 + 1 + 7)
    })
})

describe('buildTimeline', () => {
    it('draws a span for start→due, a point for one date, and skips unscheduled cards', () => {
        const timeline = buildTimeline(
            project([
                list('l1', [
                    card('span', { position: 'a0', start: day(1), due: day(4) }),
                    card('dueOnly', { position: 'a1', due: day(2) }),
                    card('startOnly', { position: 'a2', start: day(5) }),
                    card('none', { position: 'a3' }),
                ]),
                list('empty', [card('alsoNone')]),
            ]),
            MANUAL_SORT,
            TODAY
        )
        expect(timeline.groups.map(g => g.list.id)).toEqual(['l1'])
        const rows = timeline.groups[0]?.rows ?? []
        const base = timeline.todayCol
        expect(rows.map(r => [r.card.id, r.kind, r.startCol - base, r.endCol - base])).toEqual([
            ['span', 'span', 1, 4],
            ['dueOnly', 'point', 2, 2],
            ['startOnly', 'point', 5, 5],
        ])
        expect(timeline.visibleOrder).toEqual(['span', 'dueOnly', 'startOnly'])
    })

    it('clamps a start after the due date to a single day', () => {
        const timeline = buildTimeline(
            project([list('l1', [card('backwards', { start: day(5), due: day(2) })])]),
            MANUAL_SORT,
            TODAY
        )
        const row = timeline.groups[0]?.rows[0]
        expect(row && row.endCol - row.startCol).toBe(0)
    })

    it('orders rows within a group by the board sort', () => {
        const timeline = buildTimeline(
            project([
                list('l1', [card('later', { due: day(5) }), card('sooner', { due: day(1) })]),
            ]),
            { field: 'due', direction: 'asc' },
            TODAY
        )
        expect(timeline.visibleOrder).toEqual(['sooner', 'later'])
    })

    it('carries the due state for colouring', () => {
        const timeline = buildTimeline(
            project([list('l1', [card('late', { due: day(-1) }), card('ok', { due: day(9) })])]),
            MANUAL_SORT,
            TODAY
        )
        expect(timeline.groups[0]?.rows.map(r => r.dueState)).toEqual(['overdue', 'upcoming'])
    })
})

describe('dayColumns', () => {
    it('labels month starts, weekends and today', () => {
        const range = { start: new Date(2026, 7, 30), days: 5 }
        const columns = dayColumns(range, TODAY)
        expect(columns.map(c => c.label)).toEqual(['30', '31', '1', '2', '3'])
        expect(columns.map(c => c.monthLabel !== undefined)).toEqual([
            true,
            false,
            true,
            false,
            false,
        ])
        expect(columns.map(c => c.isWeekend)).toEqual([true, false, false, false, false])
        expect(columns.some(c => c.isToday)).toBe(false)
        expect(dayColumns({ start: new Date(2026, 8, 4), days: 1 }, TODAY)[0]?.isToday).toBe(true)
    })

    it('indexes across a DST change by whole days', () => {
        // US DST ends 2026-11-01: that day is 25 hours long.
        const start = new Date(2026, 9, 30)
        expect(dayIndex(start, new Date(2026, 10, 3))).toBe(4)
    })
})
