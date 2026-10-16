import { describe, expect, it } from 'vitest'
import {
    checklistProgress,
    findCardEntry,
    flattenCards,
    neighborCardId,
    pageNeighbor,
    stepCardId,
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

describe('pageNeighbor', () => {
    function numbered(numbers: Record<string, number>): BoardProject {
        const base = project()
        return {
            ...base,
            lists: base.lists.map(list => ({
                ...list,
                cards: list.cards.map(c => ({ ...c, number: numbers[c.id] ?? 0 })),
            })),
        }
    }

    it('steps to a numbered neighbour, which has a page', () => {
        expect(pageNeighbor(numbered({ a: 1, b: 2, c: 3 }), 'b', 1)?.id).toBe('c')
    })

    // An unnumbered card's page has no URL yet, so the step waits for it.
    it('steps nowhere when the neighbour has no number yet', () => {
        expect(pageNeighbor(numbered({ a: 1, b: 2 }), 'b', 1)).toBeNull()
    })

    it('steps nowhere past the ends', () => {
        expect(pageNeighbor(numbered({ a: 1, b: 2, c: 3 }), 'c', 1)).toBeNull()
    })

    it('steps back nowhere when the previous neighbour has no number yet', () => {
        expect(pageNeighbor(numbered({ b: 2, c: 3 }), 'b', -1)).toBeNull()
    })

    it('steps nowhere from a card the project does not hold', () => {
        expect(pageNeighbor(numbered({ a: 1, b: 2, c: 3 }), 'nope', 1)).toBeNull()
    })
})

describe('stepCardId', () => {
    it('steps to the neighbour of a card the project holds', () => {
        expect(stepCardId(project(), 'b', 1)).toBe('c')
        expect(stepCardId(project(), 'a', -1)).toBeNull()
    })

    it('steps from a card the project no longer holds to its first or last card', () => {
        expect(stepCardId(project(), 'not-on-board', 1)).toBe('a')
        expect(stepCardId(project(), 'not-on-board', -1)).toBe('c')
    })

    it('steps nowhere on an empty project', () => {
        const emptyProject = {
            ...project(),
            lists: project().lists.map(list => ({ ...list, cards: [] })),
        }
        expect(stepCardId(emptyProject, 'not-on-board', 1)).toBeNull()
    })
})
