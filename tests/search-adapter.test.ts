// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const navigate = vi.fn()
vi.mock('expo-router', () => ({ useRouter: () => ({ navigate }) }))
vi.mock('@tinycld/core/lib/org-routes', () => ({
    useOrgHref: () => (path: string, extra?: Record<string, string>) =>
        extra ? { pathname: `/${path}`, params: extra } : `/${path}`,
}))

import { useSearchActions } from '@tinycld/boards/search-adapter'

// A hit may name a card on a board this client has not synced (cards load per
// open board), so selection never reads the store: it hands the id to the
// bare boards route, whose id-only query waits for the row and redirects to
// the card peeked on its own board.
describe('cards useSearchActions', () => {
    afterEach(() => {
        vi.clearAllMocks()
    })

    it('navigates to the bare boards route with the card focused', () => {
        const { result } = renderHook(() => useSearchActions())
        result.current.onSelect({ slug: 'boards', id: 'c1', title: 'Ship the budget' })

        expect(navigate).toHaveBeenCalledWith({ pathname: '/boards', params: { focused: 'c1' } })
    })
})
