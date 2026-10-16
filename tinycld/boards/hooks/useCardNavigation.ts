import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useRouter } from 'expo-router'
import { createContext, useContext, useMemo, useRef } from 'react'
import { boardHref, cardPagePath, peekHref, peekSegment } from '../lib/board-route'
import { useLandOnBoard } from './useLandOnBoard'
import type { OpenCard } from './useOpenCard'

/**
 * Every way a card is opened or left. The open card is the route, so each is a
 * navigation: a push puts one more card on the stack (Back returns here),
 * `leave` pops to the board in one step.
 */
export interface CardNavigation {
    /**
     * Peek `card` over its board. `board` is the segment of ANOTHER board's
     * route, for a card the open board does not hold: that board is landed on
     * fresh (useLandOnBoard), which on web replaces the open card's history
     * entry rather than pushing one.
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
    const landOnBoard = useLandOnBoard()
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
                if (board !== segment) landOnBoard(board, peekSegment(card))
                else if (!isOnTop(card.id, 'peek')) router.push(peekHref(orgHref, segment, card))
            },
            // A card the server has not numbered is spelled by its record id,
            // which is its peek's URL; callers offer no page for one.
            openPage: card => {
                if (!isOnTop(card.id, 'page')) router.push(orgHref(cardPagePath(segment, card)))
            },
            leave: () => {
                if (openRef.current.segment) router.dismissTo(boardHref(orgHref, segment))
            },
        }
    }, [router, orgHref, segment, landOnBoard])
}

/**
 * What a surface's Expand control does, or undefined to omit the control: there
 * is no page where the navigation has none (the public board), and none for a
 * card the server has not numbered yet.
 */
export function expandAction(
    navigation: CardNavigation,
    card: { id: string; number: number }
): (() => void) | undefined {
    const { openPage } = navigation
    if (!openPage || !card.number) return undefined
    return () => openPage(card)
}
