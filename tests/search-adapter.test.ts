// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const navigate = vi.fn()
vi.mock('expo-router', () => ({ useRouter: () => ({ navigate }) }))
vi.mock('@tinycld/core/lib/org-routes', () => ({
    useOrgHref: () => (path: string, extra?: Record<string, string>) =>
        extra ? { pathname: `/${path}`, params: extra } : `/${path}`,
}))

const h = vi.hoisted(() => ({
    card: undefined as { id: string; project: string; number: number } | undefined,
    project: undefined as { id: string; slug: string } | undefined,
}))
vi.mock('@tinycld/core/lib/pocketbase', () => ({
    useStore: () => [
        { get: (id: string) => (h.card?.id === id ? h.card : undefined) },
        { get: (id: string) => (h.project?.id === id ? h.project : undefined) },
    ],
}))

const addToast = vi.fn()
vi.mock('@tinycld/core/lib/stores/toast-store', () => ({
    useToastStore: { getState: () => ({ addToast }) },
}))

import { useSearchActions } from '@tinycld/boards/search-adapter'

// Regression guard (I1): a card whose project hasn't finished syncing used to
// make onSelect silently return — pressing Enter on it looked identical to a
// working selection, since the palette closes regardless (SearchPalette only
// skips the close when NO handler runs at all). The server cannot guard this
// (the gap is a client-side sync race, not a data problem), so the check lives
// in onSelect — it must surface a toast instead of doing nothing.
describe('cards useSearchActions', () => {
    afterEach(() => {
        h.card = undefined
        h.project = undefined
        vi.clearAllMocks()
    })

    it('surfaces a toast and does not navigate when the card has not synced', () => {
        h.card = undefined
        const { result } = renderHook(() => useSearchActions())
        result.current.onSelect({ slug: 'boards', id: 'unsynced', title: 'Ship the budget' })

        expect(navigate).not.toHaveBeenCalled()
        expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' }))
    })

    // The board is in the URL, so opening a search hit is one navigation to
    // the card peeked on its own board; the board screen opens it from there.
    it('navigates to the card peeked on its board once its project has synced', () => {
        h.card = { id: 'c1', project: 'p1', number: 3 }
        h.project = { id: 'p1', slug: 'PL' }
        const { result } = renderHook(() => useSearchActions())
        result.current.onSelect({ slug: 'boards', id: 'c1', title: 'Ship the budget' })

        expect(navigate).toHaveBeenCalledWith('/boards/PL-3')
        expect(addToast).not.toHaveBeenCalled()
    })

    it('falls back to ?focused= for a card with no key', () => {
        h.card = { id: 'c1', project: 'p1', number: 0 }
        h.project = { id: 'p1', slug: '' }
        const { result } = renderHook(() => useSearchActions())
        result.current.onSelect({ slug: 'boards', id: 'c1', title: 'Ship the budget' })

        expect(navigate).toHaveBeenCalledWith({ pathname: '/boards/p1', params: { focused: 'c1' } })
    })
})
