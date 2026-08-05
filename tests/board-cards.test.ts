import { describe, expect, it } from 'vitest'
import {
    applyCardMoves,
    checklistProgress,
    findCardEntry,
    flattenCards,
    neighborCardId,
} from '../tinycld/cards/lib/board-cards'
import type { SampleProject } from '../tinycld/cards/sample-projects'

function project(): SampleProject {
    return {
        id: 'p1',
        name: 'Test',
        color: '#8b5cf6',
        members: [],
        lists: [
            {
                id: 'todo',
                name: 'Todo',
                cards: [
                    { id: 'a', title: 'A' },
                    { id: 'b', title: 'B' },
                ],
            },
            { id: 'doing', name: 'Doing', cards: [{ id: 'c', title: 'C' }] },
            { id: 'done', name: 'Done', isDone: true, cards: [] },
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

describe('applyCardMoves', () => {
    it('returns the same project when there are no moves', () => {
        const p = project()
        expect(applyCardMoves(p, {})).toBe(p)
    })

    it('moves a card to the top of the target list', () => {
        const moved = applyCardMoves(project(), { a: 'doing' })
        expect(moved.lists[0].cards.map(c => c.id)).toEqual(['b'])
        expect(moved.lists[1].cards.map(c => c.id)).toEqual(['a', 'c'])
    })

    it('keeps a card in place when moved to the list it already lives in', () => {
        const moved = applyCardMoves(project(), { b: 'todo' })
        expect(moved.lists[0].cards.map(c => c.id)).toEqual(['a', 'b'])
    })

    it('puts the most recently moved card on top', () => {
        const moved = applyCardMoves(project(), { a: 'done', c: 'done' })
        expect(moved.lists[2].cards.map(c => c.id)).toEqual(['c', 'a'])
    })

    it('ignores moves to unknown lists or of unknown cards', () => {
        const p = project()
        expect(applyCardMoves(p, { a: 'missing', ghost: 'doing' })).toBe(p)
    })
})
