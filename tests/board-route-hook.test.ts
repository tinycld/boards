// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardProject } from '../tinycld/boards/types'

// The project rows the board query should resolve, matched the way the query
// would: by id OR by slug against the route segment. useBoardRows and
// useBoardTree are stubbed rather than driving a real TanStack DB: what is
// under test is the RESOLUTION — which board and card come out for a given
// route — not the query engine.
const h = vi.hoisted(() => ({
    projects: [] as { id: string; slug: string; archived?: boolean }[],
    boardContentCalledWith: [] as string[],
    board: null as BoardProject | null,
}))

vi.mock('@tinycld/core/lib/auth', () => ({
    useAuth: () => ({ user: { id: 'u1' } }),
}))

// useBoardRows/useBoardTree are the seam the whole design rests on: the route
// hands the rows a selector from the URL and the tree the resolved rows.
// Recording every project id the tree is built for is how the resolution is
// asserted.
vi.mock('~/tinycld/boards/hooks/useActiveBoard', async importOriginal => {
    const original = await importOriginal<typeof import('~/tinycld/boards/hooks/useActiveBoard')>()
    return {
        ...original,
        useBoardRows: (selector: { id: string } | { segment: string; slug: string }) => {
            const key = 'id' in selector ? selector.id : selector.segment
            const slug = 'slug' in selector ? selector.slug : ''
            const project = key
                ? h.projects.find(p => p.id === key || (slug !== '' && p.slug === slug))
                : undefined
            return {
                rows: project ? { project } : null,
                users: [],
                isLoading: false,
            }
        },
        useBoardTree: (rows: { rows: { project?: { id: string } } | null }) => {
            const projectId = rows.rows?.project?.id ?? ''
            h.boardContentCalledWith.push(projectId)
            return {
                project: projectId ? h.board : null,
                cardCount: 0,
                isLoading: false,
            }
        },
    }
})

import { useBoardRoute } from '@tinycld/boards/hooks/useBoardRoute'

function board(): BoardProject {
    return {
        id: 'p1',
        name: 'Otters',
        slug: 'OTTER',
        color: '#4A86E8',
        members: [],
        labels: [],
        listOrder: [{ id: 'l1', position: 'a0' }],
        lists: [
            {
                id: 'l1',
                name: 'To do',
                position: 'a0',
                category: 'todo',
                cards: [
                    { id: 'c7', key: 'OTTER-7', number: 7 },
                    { id: 'c123', key: 'OTTER-123', number: 123 },
                ],
            },
        ],
    } as unknown as BoardProject
}

describe('useBoardRoute', () => {
    afterEach(() => {
        h.projects = []
        h.boardContentCalledWith = []
        h.board = null
        vi.clearAllMocks()
    })

    it('resolves a slug to its board', () => {
        h.projects = [{ id: 'p1', slug: 'OTTER' }]
        h.board = board()

        const { result } = renderHook(() => useBoardRoute('OTTER'))

        expect(h.boardContentCalledWith).toContain('p1')
        expect(result.current.project?.id).toBe('p1')
        expect(result.current.cardId).toBe('')
        expect(result.current.segment).toBe('OTTER')
    })

    it('resolves a key to the board and the card it names', () => {
        h.projects = [{ id: 'p1', slug: 'OTTER' }]
        h.board = board()

        const { result } = renderHook(() => useBoardRoute('otter-123'))

        expect(result.current.project?.id).toBe('p1')
        expect(result.current.cardId).toBe('c123')
    })

    it('resolves the full-page shape by number', () => {
        h.projects = [{ id: 'p1', slug: 'OTTER' }]
        h.board = board()

        const { result } = renderHook(() => useBoardRoute('OTTER', '7', { isViewed: false }))

        expect(result.current.cardId).toBe('c7')
    })

    // The spelling core's notifications mint, and the keyless fallback.
    it('honours ?focused= on the board it names', () => {
        h.projects = [{ id: 'p1', slug: 'OTTER' }]
        h.board = board()

        const { result } = renderHook(() => useBoardRoute('OTTER', '', { focused: 'c7' }))

        expect(result.current.cardId).toBe('c7')
    })

    // A board created without a slug is addressed by its id, and the slug
    // query is what a board with one resolves through: both are one query.
    it('resolves a board by record id', () => {
        h.projects = [{ id: 'r8f3k2m9x1p7q4w', slug: '' }]
        h.board = board()

        const { result } = renderHook(() => useBoardRoute('r8f3k2m9x1p7q4w'))

        expect(h.boardContentCalledWith).toContain('r8f3k2m9x1p7q4w')
        expect(result.current.segment).toBe('r8f3k2m9x1p7q4w')
    })

    it('resolves nothing for a slug that names no board', () => {
        const { result } = renderHook(() => useBoardRoute('GHOST'))

        expect(result.current.project).toBeNull()
        expect(result.current.isLoading).toBe(false)
        expect(result.current.segment).toBe('')
    })

    it('resolves nothing for a number that names no card on the board', () => {
        h.projects = [{ id: 'p1', slug: 'OTTER' }]
        h.board = board()

        const { result } = renderHook(() => useBoardRoute('OTTER-999'))

        expect(result.current.cardId).toBe('')
    })
})
