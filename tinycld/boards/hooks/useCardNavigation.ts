import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useRouter } from 'expo-router'
import { createContext, useContext, useMemo } from 'react'
import { boardHref, cardPagePath, peekHref } from '../lib/board-route'

/**
 * Every way a card is opened or left. The open card is the route, so each is a
 * navigation: a push puts one more card on the stack (Back returns here),
 * `leave` pops to the board in one step.
 */
export interface CardNavigation {
    /**
     * Peek `card` over its board. `board` is the segment of ANOTHER board's
     * route, for a card the open board does not hold.
     */
    openPeek: (card: { key: string; id: string }, board?: string) => void
    /** Open `card`'s full page. */
    openPage: (card: { id: string; number: number }) => void
    /** Close whatever card is open: back to the board, one step. */
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

/** The navigation of a board's own route: `segment` is the board's URL segment. */
export function useRouterCardNavigation(segment: string): CardNavigation {
    const router = useRouter()
    const orgHref = useOrgHref()
    return useMemo(() => {
        const openPeek = (card: { key: string; id: string }, board = segment) =>
            router.push(peekHref(orgHref, board, card))
        return {
            openPeek,
            // A card the server has not numbered has no page URL: its page
            // spelling would be its record id, which is a peek's.
            openPage: card =>
                card.number
                    ? router.push(orgHref(cardPagePath(segment, card)))
                    : openPeek({ key: '', id: card.id }),
            leave: () => router.dismissTo(boardHref(orgHref, segment)),
        }
    }, [router, orgHref, segment])
}
