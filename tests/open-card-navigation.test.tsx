// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { GestureResponderEvent } from 'react-native'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CardFormProvider, type CardFormValue } from '../tinycld/boards/forms/CardFormContext'
import {
    CardNavigationProvider,
    expandAction,
    useCardNavigation,
    useRouterCardNavigation,
} from '../tinycld/boards/hooks/useCardNavigation'
import { useCardSelection } from '../tinycld/boards/hooks/useCardSelection'
import type { OpenCard } from '../tinycld/boards/hooks/useOpenCard'
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

function boardNavigation(topCardSegment = 'PL-1', topCard: OpenCard = null) {
    return renderHook(() => useRouterCardNavigation('PL', topCardSegment, topCard)).result.current
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
        boardNavigation().openPage?.({ id: 'c12', number: 12 })
        expect(h.router.push).toHaveBeenCalledWith('/a/boards/PL/12')
    })

    it('offers no Expand for a card with no number, which has no page URL', () => {
        const navigation = boardNavigation()
        expect(expandAction(navigation, { id: 'abcdefghijklmno', number: 0 })).toBeUndefined()
        expandAction(navigation, { id: 'c12', number: 12 })?.()
        expect(h.router.push).toHaveBeenCalledWith('/a/boards/PL/12')
    })

    it('offers no Expand where there are no pages (the public board)', () => {
        const publicNavigation = { openPeek: vi.fn(), leave: vi.fn() }
        expect(expandAction(publicNavigation, { id: 'c12', number: 12 })).toBeUndefined()
    })

    it('leaves nothing to leave when no card is open', () => {
        boardNavigation('').leave()
        expect(h.router.dismissTo).not.toHaveBeenCalled()
    })

    it('leaves an unresolved card, which is how a not-found gets out', () => {
        boardNavigation('PL-999').leave()
        expect(h.router.dismissTo).toHaveBeenCalledWith('/a/boards/PL')
    })

    it('leaves to the board in one step', () => {
        boardNavigation().leave()
        expect(h.router.dismissTo).toHaveBeenCalledWith('/a/boards/PL')
        expect(h.router.push).not.toHaveBeenCalled()
    })

    // Expo Router has no same-URL short-circuit: a second push of the open
    // card stacks a duplicate child, which remounts the surface (losing its
    // drafts) and makes Back look like it did nothing.
    it('does not push the card already peeked on top, by key or by id', () => {
        const navigation = boardNavigation('PL-1', { cardId: 'c1', surface: 'peek' })
        navigation.openPeek({ key: 'PL-1', id: 'c1' })
        navigation.openPeek({ key: '', id: 'c1' })
        expect(h.router.push).not.toHaveBeenCalled()
    })

    it('does not push the page already on top', () => {
        boardNavigation('1', { cardId: 'c1', surface: 'page' }).openPage?.({ id: 'c1', number: 1 })
        expect(h.router.push).not.toHaveBeenCalled()
    })

    it('still changes surface for the card on top', () => {
        boardNavigation('PL-1', { cardId: 'c1', surface: 'peek' }).openPage?.({
            id: 'c1',
            number: 1,
        })
        expect(h.router.push).toHaveBeenCalledWith('/a/boards/PL/1')
        boardNavigation('1', { cardId: 'c1', surface: 'page' }).openPeek({ key: 'PL-1', id: 'c1' })
        expect(h.router.push).toHaveBeenCalledWith('/a/boards/PL/PL-1')
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
            <CardNavigationProvider value={useRouterCardNavigation('PL', '', null)}>
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
