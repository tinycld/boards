import { describe, expect, it } from 'vitest'
import { BACKLOG_KEY, backlogVisibleOrder, buildBacklog } from '../tinycld/boards/lib/backlog'
import type {
    BoardCardView,
    BoardListView,
    BoardProject,
    BoardSprint,
} from '../tinycld/boards/types'

function sprint(
    id: string,
    number: number,
    state: BoardSprint['state'],
    position = 'a0'
): BoardSprint {
    return {
        id,
        number,
        name: '',
        goal: '',
        state,
        position,
        startedAt: '',
        completedAt: '',
        cardTotal: 0,
        cardDone: 0,
        pointsTotal: 0,
        pointsDone: 0,
        committedCount: 0,
        committedPoints: 0,
        completedCount: 0,
        completedPoints: 0,
        rolledCount: 0,
    }
}

function card(
    id: string,
    listId: string,
    position: string,
    overrides: Partial<BoardCardView> = {}
): BoardCardView {
    return {
        id,
        key: '',
        listId,
        position,
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
        epic: null,
        sprint: null,
        ...overrides,
    }
}

function list(
    id: string,
    cards: BoardCardView[],
    category: BoardListView['category'] = 'todo'
): BoardListView {
    return { id, name: id, position: id, category, cards, totalCount: cards.length }
}

const active = sprint('s-active', 2, 'active')
const planned = sprint('s-planned', 3, 'planned', 'a1')
const done = sprint('s-done', 1, 'completed')

function project(lists: BoardListView[], sprints: BoardSprint[]): BoardProject {
    return {
        id: 'p1',
        name: 'Board',
        slug: 'B',
        color: '#000',
        autoArchiveDays: 0,
        sprintsEnabled: true,
        sprintLengthDays: 14,
        sprintAutoStart: false,
        sprintAutoComplete: false,
        sprintRollover: 'next',
        members: [],
        lists,
        listOrder: lists.map(l => ({ id: l.id, position: l.position })),
        cardTotal: lists.reduce((n, l) => n + l.cards.length, 0),
        labels: [],
        epics: [],
        sprints,
        unplacedCards: [],
    }
}

describe('buildBacklog', () => {
    it('groups by sprint in the board order, with the backlog last and completed apart', () => {
        const backlog = buildBacklog(
            project(
                [
                    list('todo', [
                        card('a', 'todo', 'a0', { sprint: active }),
                        card('b', 'todo', 'a1'),
                        card('c', 'todo', 'a2', { sprint: planned }),
                        card('old', 'todo', 'a3', { sprint: done }),
                    ]),
                ],
                [active, planned, done]
            )
        )
        expect(backlog.sections.map(s => s.key)).toEqual(['s-active', 's-planned', BACKLOG_KEY])
        expect(backlog.sections.map(s => s.rows.map(r => r.card.id))).toEqual([['a'], ['c'], ['b']])
        expect(backlog.completed.map(s => [s.key, s.rows.map(r => r.card.id)])).toEqual([
            ['s-done', ['old']],
        ])
    })

    // The shared rank: a section is one ordering across every list, not
    // list by list — the point of reusing `position`.
    it('orders a section by rank across lists', () => {
        const backlog = buildBacklog(
            project(
                [
                    list('todo', [card('t2', 'todo', 'a5', { sprint: active })]),
                    list('doing', [
                        card('d1', 'doing', 'a1', { sprint: active }),
                        card('d9', 'doing', 'a9', { sprint: active }),
                    ]),
                ],
                [active]
            )
        )
        expect(backlog.sections[0]?.rows.map(r => r.card.id)).toEqual(['d1', 't2', 'd9'])
    })

    it('hides finished unfiled cards from the backlog but keeps them in a sprint', () => {
        const backlog = buildBacklog(
            project(
                [
                    list('todo', [card('open', 'todo', 'a0')]),
                    list(
                        'done',
                        [
                            card('finished', 'done', 'a0', { listCategory: 'done' }),
                            card('shipped', 'done', 'a1', { listCategory: 'done', sprint: active }),
                        ],
                        'done'
                    ),
                ],
                [active]
            )
        )
        const [sprintSection, backlogSection] = backlog.sections
        expect(sprintSection?.rows.map(r => r.card.id)).toEqual(['shipped'])
        expect(backlogSection?.rows.map(r => r.card.id)).toEqual(['open'])
    })

    it('totals count and points from the rows on screen', () => {
        const backlog = buildBacklog(
            project(
                [
                    list('todo', [
                        card('a', 'todo', 'a0', { sprint: active, estimate: 3 }),
                        card('b', 'todo', 'a1', { sprint: active }),
                    ]),
                    list(
                        'done',
                        [
                            card('c', 'done', 'a0', {
                                sprint: active,
                                estimate: 5,
                                listCategory: 'done',
                            }),
                        ],
                        'done'
                    ),
                ],
                [active]
            )
        )
        expect(backlog.sections[0]?.totals).toEqual({ count: 3, done: 1, points: 8, donePoints: 5 })
    })

    it('lists the most recently completed sprint first', () => {
        const older = sprint('s-old', 1, 'completed', 'a0')
        const newer = sprint('s-new', 2, 'completed', 'a1')
        const backlog = buildBacklog(project([list('todo', [])], [older, newer]))
        expect(backlog.completed.map(s => s.key)).toEqual(['s-new', 's-old'])
    })
})

describe('backlogVisibleOrder', () => {
    it('walks the sections top to bottom and skips collapsed ones', () => {
        const backlog = buildBacklog(
            project(
                [
                    list('todo', [
                        card('a', 'todo', 'a0', { sprint: active }),
                        card('b', 'todo', 'a1'),
                        card('c', 'todo', 'a2', { sprint: done }),
                    ]),
                ],
                [active, done]
            )
        )
        expect(backlogVisibleOrder(backlog, () => false)).toEqual(['a', 'b', 'c'])
        expect(backlogVisibleOrder(backlog, key => key === 's-active')).toEqual(['b', 'c'])
    })
})
