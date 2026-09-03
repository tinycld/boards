import { describe, expect, it } from 'vitest'
import { buildArchivedCards } from '../tinycld/cards/lib/archived-cards'
import type { CardsCards } from '../tinycld/cards/types'

function card(id: string, overrides: Partial<CardsCards> = {}): CardsCards {
    return {
        id,
        project: 'p1',
        list: 'l1',
        position: 'a0',
        title: id,
        description: '',
        due: '',
        assignees: [],
        labels: [],
        created_by: 'u1',
        reporter: '',
        priority: 'none',
        archived: true,
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

const lists = [
    { id: 'l1', name: 'To do' },
    { id: 'l2', name: 'Done' },
]

describe('buildArchivedCards', () => {
    it('keeps only archived cards', () => {
        const rows = buildArchivedCards(
            [card('live', { archived: false }), card('gone')],
            lists,
            'OTTER'
        )
        expect(rows.map(r => r.id)).toEqual(['gone'])
    })

    it('resolves the key and the list name', () => {
        const [row] = buildArchivedCards([card('c1', { number: 7, list: 'l2' })], lists, 'OTTER')
        expect(row?.key).toBe('OTTER-7')
        expect(row?.listName).toBe('Done')
    })

    // A deleted list cascades its cards, so this is the unsynced-list beat,
    // not a lasting state — but the row must still render.
    it('leaves the list name empty when the list is unknown', () => {
        const [row] = buildArchivedCards([card('c1', { list: 'missing' })], lists, 'OTTER')
        expect(row?.listName).toBe('')
    })

    it('orders most recently archived first', () => {
        const rows = buildArchivedCards(
            [
                card('older', { archived_at: '2026-01-01 10:00:00.000Z' }),
                card('newer', { archived_at: '2026-02-01 10:00:00.000Z' }),
            ],
            lists,
            ''
        )
        expect(rows.map(r => r.id)).toEqual(['newer', 'older'])
    })

    // An unstamped row predates the column; it is the oldest by construction.
    it('puts rows without a stamp last, then breaks ties by id', () => {
        const rows = buildArchivedCards(
            [card('b'), card('a'), card('dated', { archived_at: '2026-01-01 10:00:00.000Z' })],
            lists,
            ''
        )
        expect(rows.map(r => r.id)).toEqual(['dated', 'a', 'b'])
    })

    it('renders no key for a board without a slug', () => {
        const [row] = buildArchivedCards([card('c1', { number: 3 })], lists, '')
        expect(row?.key).toBe('')
    })
})
