// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The rows each live query should return, keyed by the collection the query
// reads from. useBoardLiveQuery is stubbed rather than driving a real TanStack
// DB: what is under test is the RESOLUTION — which id comes out for a given
// route param — not the query engine.
const h = vi.hoisted(() => ({
    projects: [] as { id: string; slug: string }[],
    cards: [] as { id: string; project: string; number: number }[],
    storedCards: new Map<string, { id: string; project: string }>(),
    activeProjectId: '',
    boardContentCalledWith: [] as string[],
}))

vi.mock('@tinycld/core/lib/pocketbase', () => ({
    useStore: (...names: string[]) =>
        names.map(name =>
            name === 'boards_cards'
                ? { __name: name, get: (id: string) => h.storedCards.get(id) }
                : { __name: name }
        ),
}))

// A stand-in for the query builder: `from` records which collection was asked
// for, and the stub returns that collection's rows. `where` is a no-op because
// the assertions are about which id the hook picks, not about filtering.
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

const setActiveProject = vi.fn()
vi.mock('~/tinycld/boards/stores/boards-ui-store', () => ({
    useBoardsUIStore: Object.assign(
        (selector: (s: Record<string, unknown>) => unknown) =>
            selector({ activeProjectId: h.activeProjectId, setActiveProject }),
        { getState: () => ({ activeProjectId: h.activeProjectId, setActiveProject }) }
    ),
}))

// useBoardContent is the seam the whole design rests on: the route hands it a
// project id instead of reading the active board. Recording every id it is
// called with is how the cross-board cases below are asserted.
vi.mock('~/tinycld/boards/hooks/useActiveBoard', () => ({
    useBoardContent: (projectId: string) => {
        h.boardContentCalledWith.push(projectId)
        return {
            project: projectId ? { id: projectId } : null,
            cardCount: 0,
            isLoading: false,
        }
    },
}))

import { useCardRoute } from '@tinycld/boards/hooks/useCardRoute'

describe('useCardRoute', () => {
    afterEach(() => {
        h.projects = []
        h.cards = []
        h.storedCards = new Map()
        h.activeProjectId = ''
        h.boardContentCalledWith = []
        vi.clearAllMocks()
    })

    it('resolves a raw record id to the card and its own board', () => {
        h.storedCards.set('r8f3k2m9x1p7q4w', { id: 'r8f3k2m9x1p7q4w', project: 'p1' })

        const { result } = renderHook(() => useCardRoute('r8f3k2m9x1p7q4w'))

        expect(result.current.cardId).toBe('r8f3k2m9x1p7q4w')
        expect(result.current.project?.id).toBe('p1')
    })

    it('resolves a key to the same record id the board uses', () => {
        h.projects = [{ id: 'p1', slug: 'OTTER' }]
        h.cards = [
            { id: 'r8f3k2m9x1p7q4w', project: 'p1', number: 123 },
            { id: 'other', project: 'p1', number: 4 },
        ]

        const { result } = renderHook(() => useCardRoute('OTTER-123'))

        expect(result.current.cardId).toBe('r8f3k2m9x1p7q4w')
        expect(result.current.project?.id).toBe('p1')
    })

    it('resolves a lowercase key, so a typed URL still lands', () => {
        h.projects = [{ id: 'p1', slug: 'OTTER' }]
        h.cards = [{ id: 'c1', project: 'p1', number: 7 }]

        const { result } = renderHook(() => useCardRoute('otter-7'))

        expect(result.current.cardId).toBe('c1')
    })

    // THE DESIGN DECISION UNDER TEST. A key naming a board the reader is not
    // currently on must resolve by READING that board, never by switching to
    // it: setActiveProject clears openCardId and would rearrange the sidebar
    // they return to. This asserts the absence of that call, which is the whole
    // reason the hook takes the useBoardContent path instead of useActiveBoard.
    it('reads a card on a non-active board without switching to it', () => {
        h.activeProjectId = 'p-currently-open'
        h.projects = [{ id: 'p-elsewhere', slug: 'FOX' }]
        h.cards = [{ id: 'c9', project: 'p-elsewhere', number: 2 }]

        const { result } = renderHook(() => useCardRoute('FOX-2'))

        expect(result.current.cardId).toBe('c9')
        expect(result.current.project?.id).toBe('p-elsewhere')
        expect(setActiveProject).not.toHaveBeenCalled()
        expect(h.boardContentCalledWith).toContain('p-elsewhere')
    })

    // The same cross-board fix applies to plain ids, which is a bug that
    // predates keys: the screen used to read the ACTIVE board and render "this
    // card doesn't exist" for a link to anything else.
    it('resolves an id on a non-active board from the card itself', () => {
        h.activeProjectId = 'p-currently-open'
        h.storedCards.set('c5', { id: 'c5', project: 'p-elsewhere' })

        const { result } = renderHook(() => useCardRoute('c5'))

        expect(result.current.project?.id).toBe('p-elsewhere')
        expect(setActiveProject).not.toHaveBeenCalled()
    })

    it('falls back to the active board while an id has not synced', () => {
        h.activeProjectId = 'p-currently-open'

        const { result } = renderHook(() => useCardRoute('not-synced-yet'))

        expect(result.current.project?.id).toBe('p-currently-open')
    })

    it('resolves nothing for a key whose board does not exist', () => {
        h.projects = []

        const { result } = renderHook(() => useCardRoute('GHOST-1'))

        expect(result.current.cardId).toBe('')
        expect(result.current.project).toBeNull()
    })

    it('resolves nothing for a number that names no card on the board', () => {
        h.projects = [{ id: 'p1', slug: 'OTTER' }]
        h.cards = [{ id: 'c1', project: 'p1', number: 1 }]

        const { result } = renderHook(() => useCardRoute('OTTER-999'))

        expect(result.current.cardId).toBe('')
    })
})
