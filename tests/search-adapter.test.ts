// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
const replace = vi.fn()
vi.mock('expo-router', () => ({ useRouter: () => ({ push, replace }) }))
vi.mock('@tinycld/core/lib/org-routes', () => ({
    useOrgHref: () => (path: string) => `/${path}`,
}))

const h = vi.hoisted(() => ({ card: undefined as { id: string; project: string } | undefined }))
vi.mock('@tinycld/core/lib/pocketbase', () => ({
    useStore: () => [{ get: (id: string) => (h.card?.id === id ? h.card : undefined) }],
}))

const setActiveProject = vi.fn()
const openCard = vi.fn()
vi.mock('~/tinycld/cards/stores/cards-ui-store', () => ({
    useCardsUIStore: { getState: () => ({ setActiveProject, openCard }) },
}))

const addToast = vi.fn()
vi.mock('@tinycld/core/lib/stores/toast-store', () => ({
    useToastStore: { getState: () => ({ addToast }) },
}))

import { useSearchActions } from '@tinycld/cards/search-adapter'

// Regression guard (I1): a card whose project hasn't finished syncing used to
// make onSelect silently return — pressing Enter on it looked identical to a
// working selection, since the palette closes regardless (SearchPalette only
// skips the close when NO handler runs at all). The server cannot guard this
// (the gap is a client-side sync race, not a data problem), so the check lives
// in onSelect — it must surface a toast instead of doing nothing.
describe('cards useSearchActions', () => {
    afterEach(() => {
        h.card = undefined
        vi.clearAllMocks()
    })

    it('surfaces a toast and does not navigate when the card has not synced', () => {
        h.card = undefined
        const { result } = renderHook(() => useSearchActions())
        result.current.onSelect({ slug: 'cards', id: 'unsynced', title: 'Ship the budget' })

        expect(replace).not.toHaveBeenCalled()
        expect(setActiveProject).not.toHaveBeenCalled()
        expect(openCard).not.toHaveBeenCalled()
        expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' }))
    })

    it('opens the card once its project has synced', () => {
        h.card = { id: 'c1', project: 'p1' }
        const { result } = renderHook(() => useSearchActions())
        result.current.onSelect({ slug: 'cards', id: 'c1', title: 'Ship the budget' })

        expect(setActiveProject).toHaveBeenCalledWith('p1')
        expect(openCard).toHaveBeenCalledWith('c1')
        expect(addToast).not.toHaveBeenCalled()
    })
})
