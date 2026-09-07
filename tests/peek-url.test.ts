// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardProject } from '../tinycld/boards/types'

const h = vi.hoisted(() => ({
    params: {} as { boardSlug?: string; focused?: string },
    isFocused: true,
}))

const setParams = vi.fn()
const navigate = vi.fn()
vi.mock('expo-router', () => ({
    useRouter: () => ({ setParams, navigate }),
    useNavigation: () => ({ isFocused: () => h.isFocused }),
    useLocalSearchParams: () => h.params,
}))

// Mirrors the real useOrgHref (string when bare, object when params are
// present) but delegates the prefix to appHref, so this fake cannot drift from
// the app's actual route shape.
vi.mock('@tinycld/core/lib/org-routes', async importOriginal => {
    const { appHref } = await importOriginal<typeof import('@tinycld/core/lib/org-routes')>()
    return {
        appHref,
        useOrgHref: () => (path: string, extra?: Record<string, string>) =>
            extra ? { pathname: appHref(path), params: extra } : appHref(path),
    }
})

// The store is REAL: the hook's store->URL half is a subscription on it, and
// the regressions below are about the order in which the two halves see a
// write — which a mocked openCard cannot reproduce.
import { usePeekUrl } from '@tinycld/boards/hooks/usePeekUrl'
import { useBoardsUIStore } from '@tinycld/boards/stores/boards-ui-store'

function board(overrides: Partial<BoardProject> = {}): BoardProject {
    return {
        id: 'p1',
        name: 'Home projects',
        slug: 'HOME',
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
                cards: [card('c1', 'HOME-1', 1), card('c2', 'HOME-2', 2)],
            },
        ],
        ...overrides,
    } as BoardProject
}

function card(id: string, key: string, number: number) {
    return {
        id,
        key,
        number,
        listId: 'l1',
        position: 'a0',
        title: id,
        description: '',
        labels: [],
        assignees: [],
        checklistTotal: 0,
        checklistDone: 0,
        commentCount: 0,
        attachmentCount: 0,
        listCategory: 'todo',
    }
}

const openCardId = () => useBoardsUIStore.getState().openCardId

describe('usePeekUrl', () => {
    beforeEach(() => {
        useBoardsUIStore.setState({ openCardId: null })
    })
    // Unmount every hook, or its store subscription outlives the test and
    // answers the next test's writes with its own board's params.
    afterEach(() => {
        cleanup()
        h.params = {}
        h.isFocused = true
        vi.clearAllMocks()
    })

    // URL -> store: a pasted link or a fresh load opens the peek, and the URL
    // it arrived on is left exactly as it was. An earlier version wrote the
    // store->URL direction on that same render and stripped the card out of
    // its own link — paste a link, get a bare board, forever (React #185).
    it('opens the card named in the path and keeps the URL on a cold load', () => {
        h.params = { boardSlug: 'HOME-2' }
        renderHook(() => usePeekUrl(board(), 'HOME'))
        expect(openCardId()).toBe('c2')
        expect(setParams).not.toHaveBeenCalled()
    })

    it('accepts a lowercase key, so a retyped link still opens', () => {
        h.params = { boardSlug: 'home-2' }
        renderHook(() => usePeekUrl(board(), 'HOME'))
        expect(openCardId()).toBe('c2')
    })

    // The spelling core's notifications mint, and the one a keyless card uses.
    it('accepts ?focused= with a key or a raw record id', () => {
        h.params = { boardSlug: 'HOME', focused: 'HOME-1' }
        const { unmount } = renderHook(() => usePeekUrl(board(), 'HOME'))
        expect(openCardId()).toBe('c1')
        expect(setParams).not.toHaveBeenCalled()
        unmount()

        h.params = { boardSlug: 'HOME', focused: 'c2' }
        renderHook(() => usePeekUrl(board(), 'HOME'))
        expect(openCardId()).toBe('c2')
        expect(setParams).not.toHaveBeenCalled()
    })

    // A key from ANOTHER board must not resolve to whichever local card happens
    // to carry that number.
    it('ignores a key belonging to a different board', () => {
        h.params = { boardSlug: 'HOME', focused: 'FOX-2' }
        renderHook(() => usePeekUrl(board(), 'HOME'))
        expect(openCardId()).toBeNull()
    })

    // The board arrives after the URL: nothing may happen until it does, and
    // then the card opens without the URL being touched.
    it('waits for the board, then opens the card', () => {
        h.params = { boardSlug: 'HOME-2' }
        const { rerender } = renderHook(({ p }) => usePeekUrl(p, 'HOME'), {
            initialProps: { p: null as BoardProject | null },
        })
        expect(openCardId()).toBeNull()
        expect(setParams).not.toHaveBeenCalled()

        rerender({ p: board() })
        expect(openCardId()).toBe('c2')
        expect(setParams).not.toHaveBeenCalled()
    })

    // store -> URL: a click writes the key into the path.
    it('writes the key when a card opens on a bare board', () => {
        h.params = { boardSlug: 'HOME' }
        renderHook(() => usePeekUrl(board(), 'HOME'))
        act(() => useBoardsUIStore.getState().openCard('c2'))
        expect(setParams).toHaveBeenCalledWith({ boardSlug: 'HOME-2', focused: undefined })
    })

    // Closing is a TRANSITION: the store clears and the URL follows. The
    // URL->store half must not read the still-unchanged URL as an arriving
    // link and reopen the card — Escape would then be a no-op.
    it('clears the path when the peek closes, and does not reopen it', () => {
        h.params = { boardSlug: 'HOME-2' }
        const { rerender } = renderHook(() => usePeekUrl(board(), 'HOME'))
        expect(openCardId()).toBe('c2')

        act(() => useBoardsUIStore.getState().closeCard())
        expect(setParams).toHaveBeenCalledWith({ boardSlug: 'HOME', focused: undefined })
        // The URL has not caught up yet; a rerender in that window is not a
        // new instruction.
        rerender()
        expect(openCardId()).toBeNull()
        expect(setParams).toHaveBeenCalledTimes(1)
    })

    it('rewrites the path when the open card changes', () => {
        h.params = { boardSlug: 'HOME-1' }
        renderHook(() => usePeekUrl(board(), 'HOME'))
        act(() => useBoardsUIStore.getState().openCard('c2'))
        expect(setParams).toHaveBeenCalledWith({ boardSlug: 'HOME-2', focused: undefined })
    })

    // The echo of its own write: once the URL carries what the store said,
    // neither half touches the other.
    it('is quiet once the URL has caught up with the store', () => {
        h.params = { boardSlug: 'HOME' }
        const { rerender } = renderHook(() => usePeekUrl(board(), 'HOME'))
        act(() => useBoardsUIStore.getState().openCard('c2'))
        h.params = { boardSlug: 'HOME-2' }
        rerender()
        expect(openCardId()).toBe('c2')
        expect(setParams).toHaveBeenCalledTimes(1)
    })

    // A board with no slug still gets linkable cards, by record id.
    it('falls back to ?focused=<id> for a card with no key', () => {
        h.params = { boardSlug: 'p1' }
        const noSlug = board({
            slug: '',
            lists: [
                {
                    id: 'l1',
                    name: 'To do',
                    position: 'a0',
                    category: 'todo',
                    cards: [card('c1', '', 0)],
                },
            ],
        })
        renderHook(() => usePeekUrl(noSlug, 'p1'))
        act(() => useBoardsUIStore.getState().openCard('c1'))
        expect(setParams).toHaveBeenCalledWith({ boardSlug: 'p1', focused: 'c1' })
    })

    // A card's key is assigned server-side, so a card opened in the optimistic
    // window is written as its id; when the key lands nothing changes in the
    // store, so nothing is rewritten. Both spellings resolve to the card.
    it('does not rewrite the URL when the key arrives for the open card', () => {
        const keyless = board({
            lists: [
                {
                    id: 'l1',
                    name: 'To do',
                    position: 'a0',
                    category: 'todo',
                    cards: [card('c3', '', 0)],
                },
            ],
        })
        h.params = { boardSlug: 'HOME', focused: 'c3' }
        const { rerender } = renderHook(({ p }) => usePeekUrl(p, 'HOME'), {
            initialProps: { p: keyless },
        })
        expect(openCardId()).toBe('c3')

        const keyed = board({
            lists: [
                {
                    id: 'l1',
                    name: 'To do',
                    position: 'a0',
                    category: 'todo',
                    cards: [card('c3', 'HOME-3', 3)],
                },
            ],
        })
        rerender({ p: keyed })
        expect(setParams).not.toHaveBeenCalled()
        expect(openCardId()).toBe('c3')
    })

    // The board screen stays mounted under a card's full page, and a sub-task
    // row there opens through the same store. setParams would then change the
    // PAGE's params; navigate back to this board instead, which pops the page.
    it('navigates back to the board when a card opens while the page covers it', () => {
        h.params = { boardSlug: 'HOME-1' }
        renderHook(() => usePeekUrl(board(), 'HOME'))
        h.isFocused = false
        act(() => useBoardsUIStore.getState().openCard('c2'))
        expect(setParams).not.toHaveBeenCalled()
        expect(navigate).toHaveBeenCalledWith('/a/boards/HOME-2')
    })

    // Leaving a board: the store still holds the old board's card while the
    // new board's URL names none. The URL wins.
    it('closes a card left over from another board', () => {
        useBoardsUIStore.setState({ openCardId: 'elsewhere' })
        h.params = { boardSlug: 'HOME' }
        renderHook(() => usePeekUrl(board(), 'HOME'))
        expect(openCardId()).toBeNull()
        expect(setParams).not.toHaveBeenCalled()
    })
})
