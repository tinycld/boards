import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useUrlStateSync } from '@tinycld/core/lib/use-url-state-sync'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef } from 'react'
import { findCardEntry } from '../lib/board-cards'
import {
    boardPath,
    paramString,
    peekHref,
    peekParams,
    resolveCardOnBoard,
    urlCardParam,
} from '../lib/board-route'
import { useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardProject } from '../types'

/**
 * Keep the URL and the open peek in step.
 *
 * The peek is Zustand state, which is the right home for it — a dozen
 * components read `openCardId`, and a card is opened from eight of them (a
 * click, Enter, j/k, a sub-task row, a link row, a duplicate). But state alone
 * made the peek unlinkable. This is the one adapter between the two: the
 * store stays the mechanism and the URL is its projection, spelled
 * `/a/boards/PL-12` (or `?focused=<id>` for a card with no key yet — see
 * lib/board-route.ts).
 *
 * The mechanism — each direction firing only on its own side changing, so
 * the two cannot fight — is core's useUrlStateSync; what is boards' here is
 * how a card is spelled and resolved, and what to do when a card opens while
 * this screen is covered by a card's full page.
 */
export function usePeekUrl(project: BoardProject | null, segment: string) {
    const router = useRouter()
    const orgHref = useOrgHref()
    const params = useLocalSearchParams<{ boardSlug?: string; focused?: string }>()
    const boardSlug = paramString(params.boardSlug)
    const focused = paramString(params.focused)
    const openCard = useBoardsUIStore(s => s.openCard)
    const closeCard = useBoardsUIStore(s => s.closeCard)

    // The card the URL names, as an id on THIS board. Resolving through the
    // board's own cards keeps this synchronous and scoped: a URL naming another
    // board's card resolves to nothing rather than silently switching boards.
    // Undefined until the board — and its cards — have landed.
    const urlValue = project
        ? resolveCardOnBoard(project, urlCardParam(boardSlug, focused)) || null
        : undefined

    const cardOf = useCallback(
        (cardId: string | null) =>
            cardId && project ? (findCardEntry(project, cardId)?.card ?? null) : null,
        [project]
    )

    // The card this hook last spelled by its id for want of a key. Only that
    // spelling is upgraded when the key lands; a `?focused=<id>` link that
    // arrived from outside is left as it came.
    const spelledByIdRef = useRef<string | null>(null)

    useUrlStateSync<string | null>({
        isReady: project !== null,
        urlValue,
        params: { boardSlug, focused },
        format: cardId => {
            const spelled = peekParams(segment, cardOf(cardId))
            spelledByIdRef.current = spelled.focused ?? null
            return spelled
        },
        read: readOpenCard,
        write: cardId => (cardId ? openCard(cardId) : closeCard()),
        subscribe: useBoardsUIStore.subscribe,
        // This screen stays mounted under a card's full page, and a sub-task
        // or link row there opens through the same store. Navigate back to
        // this board with the card peeked, which pops the page.
        onChangeWhileBlurred: cardId => {
            const card = cardOf(cardId)
            spelledByIdRef.current = card && !card.key ? card.id : null
            router.navigate(card ? peekHref(orgHref, segment, card) : orgHref(boardPath(segment)))
        },
    })

    useKeyRespelling(project, segment, focused, spelledByIdRef)
}

/**
 * Re-spell `?focused=<id>` as the card's key once the server numbers it.
 *
 * A card opened in the optimistic window has no key yet, so the sync above
 * writes its id. When the key lands, nothing in the store changes, so the sync
 * never runs again: the address bar kept the id spelling for as long as the
 * card stayed open, and a Back from its full page returned to it.
 */
function useKeyRespelling(
    project: BoardProject | null,
    segment: string,
    focused: string,
    spelledByIdRef: { current: string | null }
) {
    const router = useRouter()
    const navigation = useNavigation()
    const openCardId = useBoardsUIStore(s => s.openCardId)
    const openKey =
        openCardId && project ? (findCardEntry(project, openCardId)?.card.key ?? '') : ''

    useEffect(() => {
        if (!openCardId || !openKey || focused !== openCardId) return
        if (spelledByIdRef.current !== openCardId || !navigation.isFocused()) return
        spelledByIdRef.current = null
        router.setParams(peekParams(segment, { key: openKey, id: openCardId }))
    }, [openCardId, openKey, focused, segment, spelledByIdRef, router, navigation])
}

function readOpenCard(): string | null {
    return useBoardsUIStore.getState().openCardId
}
