// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardProject } from '../tinycld/boards/types'

const h = vi.hoisted(() => ({
    focusedParam: '' as string,
    openCardId: null as string | null,
}))

const replace = vi.fn()
vi.mock('expo-router', () => ({
    useRouter: () => ({ replace }),
    useLocalSearchParams: () => ({ focused: h.focusedParam }),
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

const openCard = vi.fn()
vi.mock('~/tinycld/boards/stores/boards-ui-store', () => ({
    useBoardsUIStore: (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ openCardId: h.openCardId, openCard }),
}))

import { usePeekUrl } from '@tinycld/boards/hooks/usePeekUrl'

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
                cards: [card('c1', 'HOME-1'), card('c2', 'HOME-2')],
            },
        ],
        ...overrides,
    }
}

function card(id: string, key: string) {
    return {
        id,
        key,
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

describe('usePeekUrl', () => {
    afterEach(() => {
        h.focusedParam = ''
        h.openCardId = null
        vi.clearAllMocks()
    })

    // URL -> store: a pasted link or a fresh load opens the peek.
    it('opens the card named by ?focused=', () => {
        h.focusedParam = 'HOME-2'
        renderHook(() => usePeekUrl(board()))
        expect(openCard).toHaveBeenCalledWith('c2')
    })

    it('accepts a lowercase key, so a retyped link still opens', () => {
        h.focusedParam = 'home-2'
        renderHook(() => usePeekUrl(board()))
        expect(openCard).toHaveBeenCalledWith('c2')
    })

    // Links minted before keys existed must keep working.
    it('accepts a raw record id', () => {
        h.focusedParam = 'c1'
        renderHook(() => usePeekUrl(board()))
        expect(openCard).toHaveBeenCalledWith('c1')
    })

    // A key from ANOTHER board must not resolve to whichever local card happens
    // to carry that number — the full-page route is what crosses boards.
    it('ignores a key belonging to a different board', () => {
        h.focusedParam = 'FOX-2'
        renderHook(() => usePeekUrl(board()))
        expect(openCard).not.toHaveBeenCalled()
    })

    it('ignores a number that names no card here', () => {
        h.focusedParam = 'HOME-99'
        renderHook(() => usePeekUrl(board()))
        expect(openCard).not.toHaveBeenCalled()
    })

    // store -> URL: opening a card writes the key.
    it('writes the key when a card is open and the URL is bare', () => {
        h.openCardId = 'c2'
        renderHook(() => usePeekUrl(board()))
        expect(replace).toHaveBeenCalledWith({
            pathname: '/a/boards',
            params: { focused: 'HOME-2' },
        })
    })

    // Closing is a TRANSITION, not a starting state: the peek was open and the
    // URL agreed, then the card closed. Modelled as a rerender because a first
    // render with (param set, nothing open) is the cold-LOAD case instead, and
    // the two want opposite outcomes — see the cold-load test below.
    it('clears the param when the peek closes', () => {
        h.focusedParam = 'HOME-2'
        h.openCardId = 'c2'
        const { rerender } = renderHook(() => usePeekUrl(board()))
        expect(replace).not.toHaveBeenCalled()

        h.openCardId = null
        rerender()
        expect(replace).toHaveBeenCalledWith('/a/boards')
    })

    // THE CLOSE REGRESSION. Closing is not one render: the store clears first
    // and the URL is cleared by an effect, so for at least one render the peek
    // is shut while `?focused=` still names the card. The URL->store direction
    // must not treat that window as an arriving link and reopen the card —
    // Escape would then be a no-op, the peek visibly never closing.
    //
    // The store is REAL here, not a vi.fn(): with a mocked openCard the reopen
    // is invisible, which is exactly how this shipped past the existing
    // "clears the param when the peek closes" test above.
    it('does not reopen the card while the stale param is still in the URL', () => {
        h.focusedParam = 'HOME-2'
        h.openCardId = 'c2'
        const { rerender } = renderHook(() => usePeekUrl(board()))

        // The user presses Escape: the store clears, the URL has not caught up.
        h.openCardId = null
        rerender()

        expect(openCard).not.toHaveBeenCalled()
        expect(replace).toHaveBeenCalledWith('/a/boards')
    })

    // The two directions must not fight: when they already agree, neither the
    // store nor the history is touched.
    it('does nothing when the URL already matches the open card', () => {
        h.focusedParam = 'HOME-2'
        h.openCardId = 'c2'
        renderHook(() => usePeekUrl(board()))
        expect(replace).not.toHaveBeenCalled()
        expect(openCard).not.toHaveBeenCalled()
    })

    // THE KEY-ARRIVAL REGRESSION, and the most expensive of the three: a
    // needless replace() REMOUNTS the screen, taking the peek, the card detail
    // and their editors with it — a half-typed comment is destroyed mid-word.
    //
    // A card's key is assigned server-side, so the optimistic insert carries
    // none and the confirmed row brings one. Open the card in that window and
    // the URL is written as the record id; when the key lands, `desiredParam`
    // changes to HOME-3 and the naive rule ("desired disagrees with focused, so
    // write") fires a second replace for the SAME card. Both spellings already
    // resolve to it, so the rewrite buys nothing and costs the remount.
    it('does not rewrite the URL when the key arrives for the card already focused', () => {
        const keyless = board({
            lists: [
                {
                    id: 'l1',
                    name: 'To do',
                    position: 'a0',
                    category: 'todo',
                    cards: [card('c3', '')],
                },
            ],
        })
        // The peek opened before the key landed, so the URL names the record id.
        h.focusedParam = 'c3'
        h.openCardId = 'c3'
        const { rerender } = renderHook(({ p }) => usePeekUrl(p), {
            initialProps: { p: keyless },
        })
        expect(replace).not.toHaveBeenCalled()

        // The server's row arrives and the card gains HOME-3.
        const keyed = board({
            lists: [
                {
                    id: 'l1',
                    name: 'To do',
                    position: 'a0',
                    category: 'todo',
                    cards: [card('c3', 'HOME-3')],
                },
            ],
        })
        rerender({ p: keyed })
        expect(replace).not.toHaveBeenCalled()
    })

    // The guard above keys on the param RESOLVING to the open card, so it must
    // not swallow a genuine switch to a different one.
    it('still rewrites the URL when the open card changes', () => {
        h.focusedParam = 'HOME-1'
        h.openCardId = 'c1'
        const { rerender } = renderHook(() => usePeekUrl(board()))
        expect(replace).not.toHaveBeenCalled()

        h.openCardId = 'c2'
        rerender()
        expect(replace).toHaveBeenCalledWith({
            pathname: '/a/boards',
            params: { focused: 'HOME-2' },
        })
    })

    // A board with no slug still gets linkable cards, by record id.
    it('falls back to the record id for a board with no key', () => {
        h.openCardId = 'c1'
        const noSlug = board({
            slug: '',
            lists: [
                {
                    id: 'l1',
                    name: 'To do',
                    position: 'a0',
                    category: 'todo',
                    cards: [card('c1', '')],
                },
            ],
        })
        renderHook(() => usePeekUrl(noSlug))
        expect(replace).toHaveBeenCalledWith({
            pathname: '/a/boards',
            params: { focused: 'c1' },
        })
    })

    // THE COLD-LOAD REGRESSION. Pasting a link arrives here with the URL naming
    // a card and the store still empty — the two disagree for one render. An
    // earlier version wrote the store->URL direction unconditionally on that
    // render, so the link stripped its own param and landed on a bare board.
    // The peek must open and the param must survive.
    it('opens the card and keeps the param on a cold load', () => {
        h.focusedParam = 'HOME-2'
        h.openCardId = null
        renderHook(() => usePeekUrl(board()))
        expect(openCard).toHaveBeenCalledWith('c2')
        expect(replace).not.toHaveBeenCalled()
    })

    // The mirror image, which the guard above must NOT break: a param that
    // resolves to nothing is stale and should still be cleared.
    it('still clears a param that resolves to no card', () => {
        h.focusedParam = 'HOME-99'
        h.openCardId = null
        renderHook(() => usePeekUrl(board()))
        expect(replace).toHaveBeenCalledWith('/a/boards')
    })

    it('does nothing at all before the board has loaded', () => {
        h.focusedParam = 'HOME-2'
        renderHook(() => usePeekUrl(null))
        expect(openCard).not.toHaveBeenCalled()
        expect(replace).not.toHaveBeenCalled()
    })
})
