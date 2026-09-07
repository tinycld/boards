// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardProject } from '../tinycld/boards/types'

// The rows each live query should return, keyed by the collection the query
// reads from. useBoardLiveQuery is stubbed rather than driving a real TanStack
// DB: what is under test is the RESOLUTION — which board and card come out for
// a given route — not the query engine. `where` is a no-op, so each test lists
// only the rows its query would have matched.
const h = vi.hoisted(() => ({
    projects: [] as { id: string; slug: string; archived?: boolean }[],
    cards: [] as { id: string; project: string; number: number }[],
    storedProjects: new Map<string, { id: string; slug: string }>(),
    boardContentCalledWith: [] as string[],
    board: null as BoardProject | null,
}))

vi.mock('@tinycld/core/lib/pocketbase', () => ({
    useStore: (...names: string[]) =>
        names.map(name => ({
            __name: name,
            get: (id: string) =>
                name === 'boards_projects' ? h.storedProjects.get(id) : undefined,
        })),
}))

vi.mock('@tinycld/core/lib/auth', () => ({
    useAuth: () => ({ user: { id: 'u1' } }),
}))

vi.mock('~/tinycld/boards/hooks/useBoardLiveQuery', () => ({
    useBoardLiveQuery: (queryFn: (q: unknown) => unknown) => {
        let target = ''
        const builder = {
            from: (spec: Record<string, { __name: string }>) => {
                target = Object.values(spec)[0]?.__name ?? ''
                return builder
            },
            where: () => builder,
        }
        const result = queryFn(builder)
        if (result === null || result === undefined) return { data: [], isLoading: false }
        if (target === 'boards_projects') return { data: h.projects, isLoading: false }
        if (target === 'boards_cards') return { data: h.cards, isLoading: false }
        return { data: [], isLoading: false }
    },
}))

// useBoardContent is the seam the whole design rests on: the route hands it a
// project id resolved from the URL. Recording every id it is called with is
// how the resolution is asserted.
vi.mock('~/tinycld/boards/hooks/useActiveBoard', async importOriginal => {
    const original = await importOriginal<typeof import('~/tinycld/boards/hooks/useActiveBoard')>()
    return {
        ...original,
        useBoardContent: (projectId: string) => {
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
        h.cards = []
        h.storedProjects = new Map()
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
        expect(result.current.legacyCardPath).toBeNull()
    })

    // Every link minted before keys existed — and every calendar and My cards
    // link for a card the server had not numbered — spells a card as
    // /a/boards/<id>. It has a page now; the route says where.
    it('redirects a card record id to the card page', () => {
        h.cards = [{ id: 'r8f3k2m9x1p7q4w', project: 'p1', number: 7 }]
        h.storedProjects.set('p1', { id: 'p1', slug: 'OTTER' })

        const { result } = renderHook(() => useBoardRoute('r8f3k2m9x1p7q4w'))

        expect(result.current.legacyCardPath).toBe('boards/OTTER/7')
    })

    it('falls back to the project id for a redirected card whose board has no slug', () => {
        h.cards = [{ id: 'r8f3k2m9x1p7q4w', project: 'p1', number: 7 }]

        const { result } = renderHook(() => useBoardRoute('r8f3k2m9x1p7q4w'))

        expect(result.current.legacyCardPath).toBe('boards/p1/7')
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
