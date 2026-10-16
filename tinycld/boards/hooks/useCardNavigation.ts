import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useRouter } from 'expo-router'
import { createContext, useContext, useMemo, useRef } from 'react'
import { boardHref, cardPagePath, peekHref } from '../lib/board-route'
import type { OpenCard } from './useOpenCard'

/**
 * Every way a card is opened or left. The open card is the route, so each is a
 * navigation: a push puts one more card on the stack (Back returns here),
 * `leave` pops to the board in one step.
 */
export interface CardNavigation {
    /**
     * Peek `card` over its board. `board` is the segment of ANOTHER board's
     * route, for a card the open board does not hold: that board is pushed with
     * the card over it, and this one stays beneath, parked, so Back returns to
     * it with its card.
     */
    openPeek: (card: { key: string; id: string }, board?: string) => void
    /** Open `card`'s full page; absent where there are no pages (the public board). */
    openPage?: (card: { id: string; number: number }) => void
    /** Close whatever card is open, back to the board in one step; does nothing with none open. */
    leave: () => void
}

const CardNavigationContext = createContext<CardNavigation | null>(null)

/**
 * Where a card surface's navigation comes from. A context rather than each
 * caller reading the board layout, because the public board has no layout
 * route and answers the same three calls from its own store; and a Dialog's
 * portal cuts the tree on native, so CardModal re-publishes it inside.
 */
export const CardNavigationProvider = CardNavigationContext.Provider

export function useCardNavigation(): CardNavigation {
    const value = useContext(CardNavigationContext)
    if (!value) throw new Error('useCardNavigation needs a CardNavigationProvider above it')
    return value
}

/**
 * The navigation, or null where no board provides one — the card the drag
 * overlay draws is mounted by the drag provider, outside the board's tree, and
 * is never pressed. Anything a reader can act on uses `useCardNavigation`.
 */
export function useOptionalCardNavigation(): CardNavigation | null {
    return useContext(CardNavigationContext)
}

/**
 * The navigation of a board's own route: `segment` is the board's URL segment,
 * `topCardSegment` the `[card]` child on top of it, '' for none (a card that
 * names nothing here still counts: leaving it is how a reader gets out of a
 * not-found), and `topCard` what that child resolves to. The returned value is
 * stable across changes of the open card — it reads them at call time — so no
 * writer re-renders when a card opens or closes.
 *
 * Opening the card already on top, on the surface it is on, does nothing:
 * Expo Router has no same-URL short-circuit, so the push would stack a
 * duplicate child, remount the surface (losing what the reader typed in it)
 * and make Back look as if it did nothing. Compared by card id, so a key and
 * an id spelling of the same card match.
 */
export function useRouterCardNavigation(
    segment: string,
    topCardSegment: string,
    topCard: OpenCard
): CardNavigation {
    const router = useRouter()
    const orgHref = useOrgHref()
    // Written during render so the memoized navigation never goes stale; only
    // handlers read it, and a discarded render can at worst leave a newer value,
    // which costs one extra dismissTo or one skipped push of the card on top.
    const openRef = useRef({ segment: topCardSegment, card: topCard })
    openRef.current = { segment: topCardSegment, card: topCard }
    return useMemo(() => {
        const isOnTop = (cardId: string, surface: 'peek' | 'page') => {
            const top = openRef.current.card
            return top?.cardId === cardId && top.surface === surface
        }
        return {
            openPeek: (card, board = segment) => {
                if (board === segment && isOnTop(card.id, 'peek')) return
                router.push(peekHref(orgHref, board, card))
            },
            // A card the server has not numbered has no page URL; an
            // unnumbered card's Expand is disabled (expandAction), j/k on a page
            // stops at it (pageNeighbor) and a row opens its peek
            // (useOpenRelatedCard), so this never receives one.
            openPage: card => {
                if (!isOnTop(card.id, 'page')) router.push(orgHref(cardPagePath(segment, card)))
            },
            leave: () => {
                if (openRef.current.segment) router.dismissTo(boardHref(orgHref, segment))
            },
        }
    }, [router, orgHref, segment])
}

export interface ExpandAction {
    onPress: () => void
    isDisabled: boolean
    label: string
}

/**
 * What a surface's Expand control does, or undefined to omit it: there is no
 * page where the navigation has none (the public board). A card the server has
 * not numbered yet has no page URL either, but the control stays, disabled, so
 * it does not appear a moment after the card opens.
 */
export function expandAction(
    navigation: CardNavigation,
    card: { id: string; number: number }
): ExpandAction | undefined {
    const { openPage } = navigation
    if (!openPage) return undefined
    if (!card.number) {
        return { onPress: () => {}, isDisabled: true, label: 'Waiting for a card number' }
    }
    return { onPress: () => openPage(card), isDisabled: false, label: 'Open full page' }
}
