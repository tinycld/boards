import { describe, expect, it } from 'vitest'
import { columnStep, scrollOffsetFor, targetColumnForMove } from '../tinycld/cards/lib/board-focus'
import type { BoardCardView, BoardProject } from '../tinycld/cards/types'

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

/** todo: a, b, c · doing: d · done: (empty) — a short column and an empty one. */
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
                isDone: false,
                cards: [card('a', 'todo', 'a0'), card('b', 'todo', 'a1'), card('c', 'todo', 'a2')],
            },
            {
                id: 'doing',
                name: 'Doing',
                position: 'a1',
                isDone: false,
                cards: [card('d', 'doing', 'a0')],
            },
            { id: 'done', name: 'Done', position: 'a2', isDone: true, cards: [] },
        ],
    }
}

describe('columnStep', () => {
    it('keeps the row index when the target column is long enough', () => {
        expect(columnStep(project(), 'a', null, 1)).toEqual({ cardId: 'd', columnId: 'doing' })
    })

    it('clamps to the last card when the target column is shorter', () => {
        // 'c' is row 2; doing has one card, so focus lands on it rather than nothing.
        expect(columnStep(project(), 'c', null, 1)).toEqual({ cardId: 'd', columnId: 'doing' })
    })

    it('takes an empty column as a column-only target', () => {
        expect(columnStep(project(), 'd', null, 1)).toEqual({ cardId: null, columnId: 'done' })
    })

    it('steps out of an empty column back onto a card', () => {
        expect(columnStep(project(), null, 'done', -1)).toEqual({ cardId: 'd', columnId: 'doing' })
    })

    it('returns null at both edges', () => {
        expect(columnStep(project(), 'a', null, -1)).toBeNull()
        expect(columnStep(project(), null, 'done', 1)).toBeNull()
    })

    it('returns null with no focus, or for a card that is gone', () => {
        expect(columnStep(project(), null, null, 1)).toBeNull()
        expect(columnStep(project(), 'ghost', null, 1)).toBeNull()
    })
})

describe('targetColumnForMove', () => {
    it('returns the adjacent column', () => {
        expect(targetColumnForMove(project(), 'a', 1)?.id).toBe('doing')
        expect(targetColumnForMove(project(), 'd', -1)?.id).toBe('todo')
    })

    it('returns null at the edges and for an unknown card', () => {
        expect(targetColumnForMove(project(), 'a', -1)).toBeNull()
        expect(targetColumnForMove(project(), 'd', 1)?.id).toBe('done')
        expect(targetColumnForMove(project(), 'ghost', 1)).toBeNull()
    })
})

describe('scrollOffsetFor', () => {
    it('does not scroll when the target is already visible', () => {
        expect(scrollOffsetFor(0, 500, 100, 80)).toBeNull()
        // Flush against both edges still counts as visible.
        expect(scrollOffsetFor(0, 500, 0, 500)).toBeNull()
    })

    it('scrolls back to the target start when it sits before the viewport', () => {
        expect(scrollOffsetFor(300, 500, 100, 80)).toBe(100)
    })

    it('scrolls just far enough to reveal a target past the viewport end', () => {
        expect(scrollOffsetFor(0, 500, 600, 80)).toBe(180)
    })

    it('aligns a target bigger than the viewport to its start instead of oscillating', () => {
        expect(scrollOffsetFor(0, 300, 400, 500)).toBe(400)
    })

    it('never returns a negative offset', () => {
        expect(scrollOffsetFor(50, 500, -20, 10)).toBe(0)
    })
})
