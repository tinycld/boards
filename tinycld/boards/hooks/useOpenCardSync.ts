import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useNavigation, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { findCardEntry } from '../lib/board-cards'
import { boardHref, peekHref } from '../lib/board-route'
import { useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardProject } from '../types'
import { resolveOpenCard } from './useOpenCard'

/** The route shows a card segment that names no card here (yet). */
const UNRESOLVED = Symbol('unresolved')

/**
 * Keep the store's `openCardId` and the board's child stack in step, from the
 * board layout.
 *
 * The open card is the route (`/a/boards/PL/PL-12`), but the store field is
 * still how the card's openers (a press, Enter, j/k, a sub-task row, a
 * duplicate) ask for one and how the board's readers (a face's highlight, the
 * drag hooks) see it. Two directions, each firing only on its own side
 * changing, as core's useUrlStateSync does:
 *
 *   route -> store  a child's FOCUS event: the card it shows becomes the
 *                   store's, so a Back moves the readers as a push does.
 *   store -> route  a store SUBSCRIPTION: an opener's change pushes that
 *                   card's peek (so Back returns here); null dismisses to
 *                   the board.
 *
 * Both live here rather than in the children because a child's component can
 * mount well after its route is on top (a route's code may load lazily), and
 * the board is operable the whole time: a press in that window had no child
 * listening, and the child's late focus then overwrote it.
 *
 * `routeCardRef` is what the route shows, so a write from either side is never
 * read back as a request from the other. Also returns the top child's segment,
 * for what else the layout keys on it.
 */
export function useOpenCardSync(project: BoardProject, segment: string) {
    const router = useRouter()
    const orgHref = useOrgHref()
    const navigation = useNavigation()
    const [topCardSegment, setTopCardSegment] = useState('')
    const boardRef = useRef({ project, segment })
    boardRef.current = { project, segment }
    const routeCardRef = useRef<string | null | typeof UNRESOLVED>(null)

    const screenListeners = useCallback(
        ({ route }: { route: { params?: object } }) => ({
            focus: () => {
                const cardSegment = cardParam(route.params)
                setTopCardSegment(cardSegment)
                const cardId = cardSegment
                    ? (resolveOpenCard(boardRef.current.project, cardSegment)?.cardId ?? UNRESOLVED)
                    : null
                routeCardRef.current = cardId
                // An unresolved segment leaves the store as the opener set it:
                // a duplicate still saving is pushed by its id before its row
                // is on the board.
                if (cardId === UNRESOLVED) return
                if (useBoardsUIStore.getState().openCardId !== cardId) {
                    useBoardsUIStore.setState({ openCardId: cardId })
                }
            },
        }),
        []
    )

    useEffect(
        () =>
            useBoardsUIStore.subscribe((state, previous) => {
                const wanted = state.openCardId
                if (wanted === previous.openCardId || wanted === routeCardRef.current) return
                // The board is mounted under another package or My cards; an
                // opener there is not asking this board for anything.
                if (!navigation.isFocused()) return
                routeCardRef.current = wanted
                const board = boardRef.current
                if (!wanted) {
                    router.dismissTo(boardHref(orgHref, board.segment))
                    return
                }
                // A card not on the board yet goes by its id, which the child
                // resolves once the row lands.
                const card = findCardEntry(board.project, wanted)?.card ?? { key: '', id: wanted }
                router.push(peekHref(orgHref, board.segment, card))
            }),
        [router, orgHref, navigation]
    )

    return { topCardSegment, screenListeners }
}

/** The `[card]` param a child route carries, '' for the index child. */
export function cardParam(params: object | undefined): string {
    if (!params || !('card' in params)) return ''
    const card = params.card
    return typeof card === 'string' ? card : ''
}
