import { describe, expect, it } from 'vitest'
import {
    checklistProgress,
    findCardEntry,
    flattenCards,
    neighborCardId,
} from '../tinycld/boards/lib/board-cards'
import type { BoardCardView, BoardProject } from '../tinycld/boards/types'

function card(id: string, listId: string, position: string): BoardCardView {
    return {
        id,
        listId,
        position,
        title: id.toUpperCase(),
        description: '',
        labels: [],
        assignees: [],
        checklistTotal: 0,
        checklistDone: 0,
        commentCount: 0,
    }
}

function project(): BoardProject {
    return {
        id: 'p1',
        name: 'Test',
        color: '#8b5cf6',
        members: [],
        lists: [
            {
                id: 'todo',
                name: 'Todo',
                position: 'a0',
                category: 'todo',
                cards: [card('a', 'todo', 'a0'), card('b', 'todo', 'a1')],
            },
            {
                id: 'doing',
                name: 'Doing',
                position: 'a1',
                category: 'todo',
                cards: [card('c', 'doing', 'a0')],
            },
            { id: 'done', name: 'Done', position: 'a2', category: 'done', cards: [] },
        ],
    }
}

describe('checklistProgress', () => {
    it('counts done items', () => {
        const items = [
            { id: '1', title: 'x', isDone: true },
            { id: '2', title: 'y', isDone: false },
        ]
        expect(checklistProgress(items)).toEqual({ done: 1, total: 2, isComplete: false })
    })

    it('is complete only when every item is done and the list is non-empty', () => {
        expect(checklistProgress([{ id: '1', title: 'x', isDone: true }]).isComplete).toBe(true)
        expect(checklistProgress([]).isComplete).toBe(false)
    })
})

describe('flattenCards / findCardEntry', () => {
    it('walks lists in board order', () => {
        expect(flattenCards(project()).map(e => e.card.id)).toEqual(['a', 'b', 'c'])
    })

    it('finds a card with its list', () => {
        const entry = findCardEntry(project(), 'c')
        expect(entry?.list.id).toBe('doing')
    })

    it('returns null for unknown cards', () => {
        expect(findCardEntry(project(), 'nope')).toBeNull()
    })
})

describe('neighborCardId', () => {
    it('steps forward across list boundaries', () => {
        expect(neighborCardId(project(), 'b', 1)).toBe('c')
    })

    it('steps backward', () => {
        expect(neighborCardId(project(), 'b', -1)).toBe('a')
    })

    it('clamps at the ends instead of wrapping', () => {
        expect(neighborCardId(project(), 'a', -1)).toBeNull()
        expect(neighborCardId(project(), 'c', 1)).toBeNull()
    })

    it('returns null for unknown cards', () => {
        expect(neighborCardId(project(), 'nope', 1)).toBeNull()
    })
})
