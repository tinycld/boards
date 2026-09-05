import { describe, expect, it } from 'vitest'
import {
    allHave,
    partialCount,
    resolveSelection,
    selectionOrder,
    sharedValue,
    someHave,
} from '../tinycld/boards/lib/board-selection'
import type { BoardCardView, BoardProject } from '../tinycld/boards/types'

function card(id: string, listId: string, extra: Partial<BoardCardView> = {}): BoardCardView {
    return {
        id,
        listId,
        position: 'a0',
        title: id.toUpperCase(),
        description: '',
        labels: [],
        assignees: [],
        checklistTotal: 0,
        checklistDone: 0,
        commentCount: 0,
        ...extra,
    } as BoardCardView
}

/** todo: a, b · doing: c, d — two columns, so a range can span them. */
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
                cards: [card('a', 'todo'), card('b', 'todo')],
            },
            {
                id: 'doing',
                name: 'Doing',
                position: 'a1',
                category: 'in_progress',
                cards: [card('c', 'doing'), card('d', 'doing')],
            },
        ],
    } as BoardProject
}

describe('selectionOrder', () => {
    it('walks board order, list by list, when no visible order is given', () => {
        expect(selectionOrder(project())).toEqual(['a', 'b', 'c', 'd'])
    })

    // The table sorts the whole board by a field, ignoring list boundaries, so
    // a range there must follow ITS order — otherwise a shift-click in the
    // table selects a run the user never saw.
    it('defers to the view order when one is given', () => {
        expect(selectionOrder(project(), ['d', 'a', 'c'])).toEqual(['d', 'a', 'c'])
    })
})

describe('resolveSelection', () => {
    it('returns the selected cards with their lists, in board order', () => {
        const resolved = resolveSelection(project(), new Set(['c', 'a']))
        expect(resolved.map(entry => entry.card.id)).toEqual(['a', 'c'])
        expect(resolved.map(entry => entry.list.id)).toEqual(['todo', 'doing'])
    })

    // The whole reason selection is re-derived at the point of use: another
    // client archiving a selected card must become a skipped row, not a write
    // against a row that is gone.
    it('drops ids that are no longer on the board', () => {
        const resolved = resolveSelection(project(), new Set(['a', 'ghost']))
        expect(resolved.map(entry => entry.card.id)).toEqual(['a'])
    })

    it('is empty for an empty selection', () => {
        expect(resolveSelection(project(), new Set())).toEqual([])
    })
})

describe('allHave / someHave', () => {
    const withLabels = (ids: string[]) =>
        ids.map(id => ({ card: card(id, 'todo', { labels: [{ id: 'bug' }] }), list: {} }))
    const withoutLabels = (ids: string[]) => ids.map(id => ({ card: card(id, 'todo'), list: {} }))

    it('reports all when every card carries the id', () => {
        const cards = withLabels(['a', 'b']) as never
        expect(allHave(cards, 'labels', 'bug')).toBe(true)
        expect(someHave(cards, 'labels', 'bug')).toBe(true)
    })

    // The mixed state: the picker must render this as indeterminate, and a
    // press must ADD to the cards that lack it rather than toggle each.
    it('reports some but not all for a partial selection', () => {
        const cards = [...withLabels(['a']), ...withoutLabels(['b'])] as never
        expect(allHave(cards, 'labels', 'bug')).toBe(false)
        expect(someHave(cards, 'labels', 'bug')).toBe(true)
    })

    it('reports neither when no card carries the id', () => {
        const cards = withoutLabels(['a', 'b']) as never
        expect(allHave(cards, 'labels', 'bug')).toBe(false)
        expect(someHave(cards, 'labels', 'bug')).toBe(false)
    })

    // An empty selection is not "all" — otherwise the picker would render every
    // label as checked the moment the last card is deselected.
    it('does not report all for an empty selection', () => {
        expect(allHave([], 'labels', 'bug')).toBe(false)
    })
})

describe('sharedValue', () => {
    const entries = (priorities: string[]) =>
        priorities.map(priority => ({
            card: card('c', 'todo', { priority } as Partial<BoardCardView>),
            list: {},
        })) as never

    it('returns the value when every card agrees', () => {
        expect(sharedValue(entries(['high', 'high']), c => c.priority)).toBe('high')
    })

    // A mixed selection has no current value, and a picker that marked one
    // would claim something about the cards that is not true.
    it('returns undefined when the cards disagree', () => {
        expect(sharedValue(entries(['high', 'low']), c => c.priority)).toBeUndefined()
    })

    it('returns undefined for an empty selection', () => {
        expect(sharedValue([], c => c.priority)).toBeUndefined()
    })
})

describe('partialCount', () => {
    const OPTIONS = [{ id: 'bug' }, { id: 'chore' }, { id: 'epic' }]
    const withLabels = (ids: string[]) => ({
        card: card('c', 'todo', { labels: ids.map(id => ({ id })) } as Partial<BoardCardView>),
        list: {},
    })

    // Only the label held by SOME counts: one held by all is uniform, and one
    // held by none is simply absent. Neither would surprise the user.
    it('counts only the values the selection disagrees about', () => {
        const cards = [withLabels(['bug', 'chore']), withLabels(['bug'])] as never
        expect(partialCount(cards, 'labels', OPTIONS)).toBe(1)
    })

    it('counts nothing when the selection is uniform', () => {
        const cards = [withLabels(['bug']), withLabels(['bug'])] as never
        expect(partialCount(cards, 'labels', OPTIONS)).toBe(0)
    })

    it('counts nothing for an empty selection', () => {
        expect(partialCount([], 'labels', OPTIONS)).toBe(0)
    })
})
