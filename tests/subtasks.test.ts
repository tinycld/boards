import { describe, expect, it } from 'vitest'
import {
    canBeParentOf,
    childrenOf,
    formatSubtaskRollup,
    hasSubtasks,
    parentCandidates,
    parentOf,
    subtasksComplete,
} from '../tinycld/cards/lib/subtasks'
import type { BoardCardView } from '../tinycld/cards/types'

function card(id: string, overrides: Partial<BoardCardView> = {}): BoardCardView {
    return {
        id,
        key: `OTTER-${id.replace(/\D/g, '') || '1'}`,
        listId: 'l1',
        position: 'a0',
        title: id,
        description: '',
        dueHasTime: false,
        labels: [],
        assignees: [],
        priority: 'none',
        listCategory: 'todo',
        created: '',
        checklistTotal: 0,
        checklistDone: 0,
        commentCount: 0,
        attachmentCount: 0,
        parent: '',
        parentKey: '',
        subtaskTotal: 0,
        subtaskDone: 0,
        ...overrides,
    }
}

describe('canBeParentOf', () => {
    it('refuses the card itself', () => {
        const subject = card('c1')
        expect(canBeParentOf(subject, subject)).toBe(false)
    })

    it('refuses a card that is already a sub-task', () => {
        expect(canBeParentOf(card('c2', { parent: 'c3' }), card('c1'))).toBe(false)
    })

    // The depth cap is what makes this true: a child of the subject is itself a
    // card with a parent, so the "already a sub-task" clause catches the cycle
    // without a separate ancestor walk. See the note in lib/subtasks.ts.
    it('refuses the subject’s own child, via the depth rule', () => {
        expect(canBeParentOf(card('c2', { parent: 'c1' }), card('c1'))).toBe(false)
    })

    it('accepts an unrelated top-level card', () => {
        expect(canBeParentOf(card('c2'), card('c1'))).toBe(true)
    })
})

describe('parentCandidates', () => {
    it('keeps board order and drops self and existing sub-tasks', () => {
        const subject = card('c1')
        const cards = [subject, card('c2'), card('c3', { parent: 'c2' }), card('c4')]
        expect(parentCandidates(cards, subject).map(c => c.id)).toEqual(['c2', 'c4'])
    })
})

describe('childrenOf', () => {
    it('finds direct children only', () => {
        const parent = card('c1')
        const cards = [
            parent,
            card('c2', { parent: 'c1' }),
            card('c3'),
            card('c4', { parent: 'c1' }),
        ]
        expect(childrenOf(cards, parent).map(c => c.id)).toEqual(['c2', 'c4'])
    })

    it('is empty for a card nothing points at', () => {
        expect(childrenOf([card('c1'), card('c2')], card('c1'))).toEqual([])
    })
})

describe('parentOf', () => {
    it('resolves the parent card', () => {
        const cards = [card('c1'), card('c2', { parent: 'c1' })]
        expect(parentOf(cards, cards[1])?.id).toBe('c1')
    })

    it('is undefined for a top-level card', () => {
        expect(parentOf([card('c1')], card('c1'))).toBeUndefined()
    })

    // `parent` does not cascade — deleting a parent deliberately orphans its
    // children rather than destroying them — so a dangling id is an ordinary
    // state, not corruption, and must read as "top level".
    it('is undefined when the parent has been deleted', () => {
        const orphan = card('c2', { parent: 'gone' })
        expect(parentOf([orphan], orphan)).toBeUndefined()
    })
})

describe('the rollup', () => {
    it('shows only when there are sub-tasks', () => {
        expect(hasSubtasks(card('c1'))).toBe(false)
        expect(hasSubtasks(card('c1', { subtaskTotal: 3 }))).toBe(true)
    })

    it('formats as done/total', () => {
        expect(formatSubtaskRollup(card('c1', { subtaskTotal: 5, subtaskDone: 2 }))).toBe('2/5')
    })

    it('is complete only when every sub-task is closed, and never when empty', () => {
        expect(subtasksComplete(card('c1', { subtaskTotal: 3, subtaskDone: 3 }))).toBe(true)
        expect(subtasksComplete(card('c1', { subtaskTotal: 3, subtaskDone: 2 }))).toBe(false)
        // 0/0 is not "all done" — an empty card would otherwise render the
        // success tint, which reads as work completed that never existed.
        expect(subtasksComplete(card('c1'))).toBe(false)
    })
})
