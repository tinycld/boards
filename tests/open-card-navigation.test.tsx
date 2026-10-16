// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { GestureResponderEvent } from 'react-native'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CardFormProvider, type CardFormValue } from '../tinycld/boards/forms/CardFormContext'
import {
    CardNavigationProvider,
    useCardNavigation,
    useRouterCardNavigation,
} from '../tinycld/boards/hooks/useCardNavigation'
import { useCardSelection } from '../tinycld/boards/hooks/useCardSelection'
import { useOpenRelatedCard } from '../tinycld/boards/hooks/useOpenRelatedCard'
import { cardParam } from '../tinycld/boards/hooks/useTopCardSegment'

// Every writer reaches the router through useCardNavigation, so what the router
// records is the whole contract: a push for a card, one dismissTo for leaving.
const h = vi.hoisted(() => ({
    router: { push: vi.fn(), dismissTo: vi.fn() },
}))

vi.mock('expo-router', () => ({ useRouter: () => h.router }))

beforeEach(() => {
    h.router.push.mockClear()
    h.router.dismissTo.mockClear()
})

function boardNavigation() {
    return renderHook(() => useRouterCardNavigation('PL')).result.current
}

describe('card navigation', () => {
    it('peeks a card with a push', () => {
        boardNavigation().openPeek({ key: 'PL-12', id: 'c12' })
        expect(h.router.push).toHaveBeenCalledWith('/a/boards/PL/PL-12')
    })

    it('peeks an unkeyed card by its id', () => {
        boardNavigation().openPeek({ key: '', id: 'abcdefghijklmno' })
        expect(h.router.push).toHaveBeenCalledWith('/a/boards/PL/abcdefghijklmno')
    })

    it('peeks a card of another board on that board', () => {
        boardNavigation().openPeek({ key: 'OTTER-3', id: 'c3' }, 'OTTER')
        expect(h.router.push).toHaveBeenCalledWith('/a/boards/OTTER/OTTER-3')
    })

    it('opens a page with a push', () => {
        boardNavigation().openPage({ id: 'c12', number: 12 })
        expect(h.router.push).toHaveBeenCalledWith('/a/boards/PL/12')
    })

    it('peeks a card with no number, which has no page URL', () => {
        boardNavigation().openPage({ id: 'abcdefghijklmno', number: 0 })
        expect(h.router.push).toHaveBeenCalledWith('/a/boards/PL/abcdefghijklmno')
    })

    it('leaves to the board in one step', () => {
        boardNavigation().leave()
        expect(h.router.dismissTo).toHaveBeenCalledWith('/a/boards/PL')
        expect(h.router.push).not.toHaveBeenCalled()
    })

    it('needs a provider', () => {
        expect(() => renderHook(() => useCardNavigation())).toThrow()
    })
})

describe('opening a card from a row inside an open card', () => {
    const card = { id: 'c12', key: 'PL-12', number: 12 }

    function open(variant: CardFormValue['variant']) {
        const wrapper = ({ children }: { children: ReactNode }) => (
            <Navigation>
                <CardFormProvider value={{ variant } as CardFormValue}>{children}</CardFormProvider>
            </Navigation>
        )
        renderHook(() => useOpenRelatedCard(), { wrapper }).result.current(card)
    }

    function Navigation({ children }: { children: ReactNode }) {
        return (
            <CardNavigationProvider value={useRouterCardNavigation('PL')}>
                {children}
            </CardNavigationProvider>
        )
    }

    it('pushes the page from a page', () => {
        open('page')
        expect(h.router.push).toHaveBeenCalledWith('/a/boards/PL/12')
    })

    it('pushes the peek from a peek', () => {
        open('peek')
        expect(h.router.push).toHaveBeenCalledWith('/a/boards/PL/PL-12')
    })
})

describe('the card on top of the board', () => {
    it('is the card param of the focused child, empty on the index child', () => {
        expect(cardParam({ boardSlug: 'PL', card: 'PL-3' })).toBe('PL-3')
        expect(cardParam({ boardSlug: 'PL' })).toBe('')
        expect(cardParam(undefined)).toBe('')
    })
})

describe('a card the drag overlay draws', () => {
    it('presses into nothing, outside any board', () => {
        const press = renderHook(() => useCardSelection()).result.current
        expect(() =>
            press({ key: 'PL-1', id: 'c1' }, { nativeEvent: {} } as GestureResponderEvent)
        ).not.toThrow()
        expect(h.router.push).not.toHaveBeenCalled()
    })
})
