import { describe, expect, it } from 'vitest'
import {
    buildMyCardRows,
    groupMyCards,
    isMine,
    type JoinedRow,
    sortMyCards,
} from '../tinycld/cards/lib/my-cards'
import type { CardsCards, CardsLists, CardsProjects } from '../tinycld/cards/types'

const NOW = new Date(2026, 8, 3, 12)
const day = (n: number) => `2026-09-${String(3 + n).padStart(2, '0')} 00:00:00.000Z`

function project(id: string, name: string, overrides: Partial<CardsProjects> = {}): CardsProjects {
    return {
        id,
        name,
        slug: id.toUpperCase(),
        next_number: 1,
        color: '#8b5cf6',
        visibility: 'private',
        created_by: 'u1',
        archived: false,
        created: '',
        updated: '',
        ...overrides,
    }
}

function list(id: string, projectId: string, name = 'To do'): CardsLists {
    return {
        id,
        project: projectId,
        name,
        position: 'a0',
        is_done: false,
        created: '',
        updated: '',
    }
}

function card(id: string, projectId: string, overrides: Partial<CardsCards> = {}): CardsCards {
    return {
        id,
        project: projectId,
        list: `${projectId}-l`,
        position: 'a0',
        title: id,
        description: '',
        due: '',
        assignees: [],
        labels: [],
        created_by: 'u1',
        reporter: '',
        priority: 'none',
        archived: false,
        archived_at: '',
        number: 1,
        checklist_total: 0,
        checklist_done: 0,
        comment_count: 0,
        attachment_count: 0,
        created: '',
        updated: '',
        ...overrides,
    }
}

function row(cardRecord: CardsCards, projectRecord: CardsProjects): JoinedRow {
    return {
        card: cardRecord,
        project: projectRecord,
        list: list(`${projectRecord.id}-l`, projectRecord.id),
    }
}

const users = [{ id: 'u1', name: 'Maya Kim', email: '' }]

describe('isMine', () => {
    it('assigned matches an assignee', () => {
        expect(isMine(card('c', 'p', { assignees: ['u1'] }), 'assigned', 'u1')).toBe(true)
        expect(isMine(card('c', 'p'), 'assigned', 'u1')).toBe(false)
    })

    it('reported falls back to the creator', () => {
        expect(isMine(card('c', 'p', { created_by: 'u1' }), 'reported', 'u1')).toBe(true)
        expect(isMine(card('c', 'p', { created_by: 'u1', reporter: 'u2' }), 'reported', 'u1')).toBe(
            false
        )
    })

    it("watching reads the caller's watcher rows", () => {
        const watched = new Set(['c'])
        expect(isMine(card('c', 'p'), 'watching', 'u1', watched)).toBe(true)
        expect(isMine(card('d', 'p'), 'watching', 'u1', watched)).toBe(false)
        expect(isMine(card('c', 'p'), 'watching', 'u1')).toBe(false)
    })

    it('all is everything, but nothing is mine without a user', () => {
        expect(isMine(card('c', 'p'), 'all', 'u1')).toBe(true)
        expect(isMine(card('c', 'p', { assignees: ['u1'] }), 'assigned', '')).toBe(false)
    })
})

describe('buildMyCardRows', () => {
    const p1 = project('p1', 'Alpha board')

    it('resolves the board, list and key, and drops archived cards and boards', () => {
        const rows = buildMyCardRows({
            rows: [
                row(card('live', 'p1', { number: 4 }), p1),
                row(card('archived', 'p1', { archived: true }), p1),
                row(card('onArchived', 'p2'), project('p2', 'Old', { archived: true })),
            ],
            labels: [],
            users,
            mode: 'all',
            userId: 'u1',
            text: '',
        })
        expect(rows.map(r => r.card.id)).toEqual(['live'])
        expect(rows[0]?.card.key).toBe('P1-4')
        expect(rows[0]?.board.name).toBe('Alpha board')
        expect(rows[0]?.list.name).toBe('To do')
    })

    it('applies the keyword to title and key', () => {
        const rows = buildMyCardRows({
            rows: [
                row(card('c1', 'p1', { title: 'Fix login', number: 9 }), p1),
                row(card('c2', 'p1', { title: 'Write docs' }), p1),
            ],
            labels: [],
            users,
            mode: 'all',
            userId: 'u1',
            text: 'p1-9',
        })
        expect(rows.map(r => r.card.id)).toEqual(['c1'])
    })
})

describe('sortMyCards', () => {
    const p1 = project('p1', 'Alpha')
    const p2 = project('p2', 'Beta')
    const build = (rows: JoinedRow[]) =>
        buildMyCardRows({ rows, labels: [], users, mode: 'all', userId: 'u1', text: '' })

    it('puts overdue first, then dated ascending, then undated by board', () => {
        const rows = sortMyCards(
            build([
                row(card('undatedBeta', 'p2'), p2),
                row(card('later', 'p1', { due: day(5) }), p1),
                row(card('overdue', 'p2', { due: day(-2) }), p2),
                row(card('soon', 'p1', { due: day(1) }), p1),
                row(card('undatedAlpha', 'p1'), p1),
            ]),
            NOW
        )
        expect(rows.map(r => r.card.id)).toEqual([
            'overdue',
            'soon',
            'later',
            'undatedAlpha',
            'undatedBeta',
        ])
    })
})

describe('groupMyCards', () => {
    const p1 = project('p1', 'Alpha')
    const p2 = project('p2', 'Beta')
    const rows = sortMyCards(
        buildMyCardRows({
            rows: [
                row(card('today', 'p1', { due: day(0) }), p1),
                row(card('overdue', 'p2', { due: day(-1) }), p2),
                row(card('soon', 'p1', { due: day(2) }), p1),
                row(card('later', 'p2', { due: day(9) }), p2),
                row(card('none', 'p1'), p1),
            ],
            labels: [],
            users,
            mode: 'all',
            userId: 'u1',
            text: '',
        }),
        NOW
    )

    it('by board keeps first-appearance order and carries the colour', () => {
        const groups = groupMyCards(rows, 'board', NOW)
        expect(groups.map(g => g.title)).toEqual(['Beta', 'Alpha'])
        expect(groups[0]?.color).toBe('#8b5cf6')
        expect(groups[1]?.rows.map(r => r.card.id)).toEqual(['today', 'soon', 'none'])
    })

    it('by due buckets into overdue, today, next 2 days, later, none', () => {
        const groups = groupMyCards(rows, 'due', NOW)
        expect(groups.map(g => [g.title, g.rows.map(r => r.card.id)])).toEqual([
            ['Overdue', ['overdue']],
            ['Today', ['today']],
            ['Next 2 days', ['soon']],
            ['Later', ['later']],
            ['No due date', ['none']],
        ])
    })
})
