import { describe, expect, it } from 'vitest'
import { flattenBoardRows } from '../tinycld/cards/lib/board-rows'
import { MANUAL_SORT } from '../tinycld/cards/lib/board-sort'
import type { BoardCardView, BoardProject } from '../tinycld/cards/types'

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

const project: BoardProject = {
    id: 'p1',
    name: 'Board',
    slug: '',
    color: '#000',
    autoArchiveDays: 0,
    members: [],
    labels: [],
    lists: [
        {
            id: 'l1',
            name: 'To do',
            position: 'a0',
            category: 'todo',
            totalCount: 2,
            cards: [card('a', { priority: 'low' }), card('b', { priority: 'urgent' })],
        },
        {
            id: 'l2',
            name: 'Done',
            position: 'a1',
            category: 'done',
            totalCount: 1,
            cards: [card('c', { priority: 'high', listId: 'l2' })],
        },
    ],
    listOrder: [
        { id: 'l1', position: 'a0' },
        { id: 'l2', position: 'a1' },
    ],
    cardTotal: 3,
    unplacedCards: [],
}

describe('flattenBoardRows', () => {
    it('manual order is board order, with the list beside each card', () => {
        const rows = flattenBoardRows(project, MANUAL_SORT)
        expect(rows.map(r => `${r.list.name}:${r.card.id}`)).toEqual([
            'To do:a',
            'To do:b',
            'Done:c',
        ])
    })

    it('a field sort orders across lists', () => {
        const rows = flattenBoardRows(project, { field: 'priority', direction: 'asc' })
        expect(rows.map(r => r.card.id)).toEqual(['b', 'c', 'a'])
    })

    it('does not mutate the board', () => {
        flattenBoardRows(project, { field: 'priority', direction: 'desc' })
        expect(project.lists[0]?.cards.map(c => c.id)).toEqual(['a', 'b'])
    })
})
