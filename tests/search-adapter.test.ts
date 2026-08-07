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

import { toRow, useSearchActions } from '@tinycld/cards/search-adapter'

describe('cards toRow', () => {
    it('maps a hit to a row with the card title', () => {
        const row = toRow({ id: 'c1', title: 'Ship the budget', project: 'p1', list: 'l1' })
        expect(row).toEqual({
            id: 'c1',
            title: 'Ship the budget',
            subtitle: undefined,
            meta: undefined,
        })
    })

    it('keeps a hit whose title is empty', () => {
        expect(toRow({ id: 'c1', title: '', project: 'p1', list: 'l1' })?.title).toBe(
            'Untitled card'
        )
    })
})

// Regression guard (I1): a card whose project hasn't finished syncing used to
// make onSelect silently return — pressing Enter on it looked identical to a
// working selection, since the palette closes regardless (SearchPalette only
// skips the close when NO handler runs at all). toRow can't guard this itself
// (it's a pure function with no access to cardsCollection), so the check has
// to stay in onSelect — it must now surface a toast instead of doing nothing.
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
