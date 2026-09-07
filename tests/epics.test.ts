import { describe, expect, it } from 'vitest'
import { boardUsesEpics } from '../tinycld/boards/lib/epics'
import type { BoardEpic } from '../tinycld/boards/types'

function epic(overrides: Partial<BoardEpic> = {}): BoardEpic {
    return {
        id: 'e1',
        title: 'Launch',
        color: '#6A1B9A',
        position: 'a',
        archived: false,
        pointsTotal: 0,
        pointsDone: 0,
        ...overrides,
    }
}

// The Epic row hides on a board that has nothing to file under, so a board
// that never set up epics does not carry a row whose only content is "No
// epics on this board yet".
describe('boardUsesEpics', () => {
    it('is false on a board with no epics', () => {
        expect(boardUsesEpics([], { epic: null })).toBe(false)
    })

    it('is true once the board has an open epic', () => {
        expect(boardUsesEpics([epic()], { epic: null })).toBe(true)
    })

    it('ignores archived epics the card is not in', () => {
        expect(boardUsesEpics([epic({ archived: true })], { epic: null })).toBe(false)
    })

    it('keeps the row for a card filed under an archived epic', () => {
        const archived = epic({ archived: true })
        expect(boardUsesEpics([archived], { epic: archived })).toBe(true)
    })
})
