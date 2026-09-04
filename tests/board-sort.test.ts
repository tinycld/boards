import { describe, expect, it } from 'vitest'
import { compareCards, MANUAL_SORT, toggleSort } from '../tinycld/boards/lib/board-sort'
import type { BoardCardView } from '../tinycld/boards/types'

function card(id: string, overrides: Partial<BoardCardView> = {}): BoardCardView {
    return {
        id,
        key: '',
        listId: 'l1',
        position: 'a0',
        title: id,
        description: '',
        due: undefined,
        dueHasTime: false,
        labels: [],
        assignees: [],
        reporter: undefined,
        priority: 'none',
        created: '',
        checklistTotal: 0,
        checklistDone: 0,
        commentCount: 0,
        attachmentCount: 0,
        listCategory: 'todo',
        ...overrides,
    }
}

const ids = (cards: BoardCardView[]) => cards.map(c => c.id)

describe('compareCards', () => {
    it('manual is rank order, id as the tiebreak, in either direction', () => {
        const cards = [
            card('b', { position: 'a1' }),
            card('a', { position: 'a1' }),
            card('z', { position: 'a0' }),
        ]
        expect(ids([...cards].sort(compareCards(MANUAL_SORT)))).toEqual(['z', 'a', 'b'])
        expect(ids([...cards].sort(compareCards({ field: 'manual', direction: 'desc' })))).toEqual([
            'z',
            'a',
            'b',
        ])
    })

    it('puts undated cards last in both directions', () => {
        const cards = [
            card('none'),
            card('late', { due: new Date(2026, 5, 1) }),
            card('early', { due: new Date(2026, 0, 1) }),
        ]
        expect(ids([...cards].sort(compareCards({ field: 'due', direction: 'asc' })))).toEqual([
            'early',
            'late',
            'none',
        ])
        expect(ids([...cards].sort(compareCards({ field: 'due', direction: 'desc' })))).toEqual([
            'late',
            'early',
            'none',
        ])
    })

    it('orders by start date with unstarted cards last', () => {
        const cards = [
            card('none'),
            card('late', { start: new Date(2026, 5, 1) }),
            card('early', { start: new Date(2026, 0, 1) }),
        ]
        expect(ids([...cards].sort(compareCards({ field: 'start', direction: 'asc' })))).toEqual([
            'early',
            'late',
            'none',
        ])
        expect(ids([...cards].sort(compareCards({ field: 'start', direction: 'desc' })))).toEqual([
            'late',
            'early',
            'none',
        ])
    })

    it('orders by estimate and puts unestimated cards last in both directions', () => {
        const cards = [card('none'), card('big', { estimate: 8 }), card('small', { estimate: 2 })]
        expect(ids([...cards].sort(compareCards({ field: 'estimate', direction: 'asc' })))).toEqual(
            ['small', 'big', 'none']
        )
        expect(
            ids([...cards].sort(compareCards({ field: 'estimate', direction: 'desc' })))
        ).toEqual(['big', 'small', 'none'])
    })

    it('breaks a tie on the chosen field by rank', () => {
        const cards = [
            card('second', { priority: 'high', position: 'a1' }),
            card('first', { priority: 'high', position: 'a0' }),
            card('urgent', { priority: 'urgent', position: 'a9' }),
        ]
        expect(ids([...cards].sort(compareCards({ field: 'priority', direction: 'asc' })))).toEqual(
            ['urgent', 'first', 'second']
        )
    })

    it('orders titles case-insensitively', () => {
        const cards = [card('b', { title: 'banana' }), card('a', { title: 'Apple' })]
        expect(ids([...cards].sort(compareCards({ field: 'title', direction: 'asc' })))).toEqual([
            'a',
            'b',
        ])
    })

    it('orders keys numerically, unkeyed last', () => {
        const cards = [
            card('ten', { key: 'OTTER-10' }),
            card('none'),
            card('two', { key: 'OTTER-2' }),
        ]
        expect(ids([...cards].sort(compareCards({ field: 'key', direction: 'asc' })))).toEqual([
            'two',
            'ten',
            'none',
        ])
    })

    // An optimistic insert has no timestamp yet and belongs at the bottom,
    // exactly as byCreatedThenId places it for comments.
    it('orders by created with the unstamped last', () => {
        const cards = [
            card('new'),
            card('old', { created: '2026-01-01 00:00:00.000Z' }),
            card('mid', { created: '2026-02-01 00:00:00.000Z' }),
        ]
        expect(ids([...cards].sort(compareCards({ field: 'created', direction: 'asc' })))).toEqual([
            'old',
            'mid',
            'new',
        ])
    })
})

describe('toggleSort', () => {
    it('starts a new field ascending and flips a repeated one', () => {
        expect(toggleSort(MANUAL_SORT, 'due')).toEqual({ field: 'due', direction: 'asc' })
        expect(toggleSort({ field: 'due', direction: 'asc' }, 'due')).toEqual({
            field: 'due',
            direction: 'desc',
        })
        expect(toggleSort({ field: 'due', direction: 'desc' }, 'manual')).toBe(MANUAL_SORT)
    })
})
