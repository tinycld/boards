import { eq, or } from '@tanstack/db'
import { useAuth } from '@tinycld/core/lib/auth'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useMemo } from 'react'
import { flattenCards } from '../lib/board-cards'
import type { BoardViewOptions } from '../lib/board-project'
import {
    boardSegment,
    cardPagePath,
    isRecordId,
    parseBoardSegment,
    parseCardNumber,
    resolveCardOnBoard,
    urlCardParam,
} from '../lib/board-route'
import { parseCardKey } from '../lib/card-key'
import {
    selectBoardFilter,
    selectBoardSort,
    selectSprintScope,
    selectViewMode,
    useBoardsUIStore,
} from '../stores/boards-ui-store'
import type { BoardProject } from '../types'
import { scopeForView, useBoardContent } from './useActiveBoard'
import { useBoardLiveQuery } from './useBoardLiveQuery'

/**
 * Resolve `/a/boards/<segment>[/<cardNumber>]` to a board and, where the URL
 * names one, a card.
 *
 * THE URL IS THE SOURCE OF TRUTH for which board is on screen. The board used
 * to live only in Zustand, which made it unlinkable — a pasted link landed on
 * whichever board the reader had open last. Nothing here reads the store to
 * decide what to render; the screen writes the store afterwards so the bare
 * `/a/boards` can return to where the reader was.
 *
 * The segment shapes are documented in lib/board-route.ts. The one thing a
 * parser cannot tell is whether a 15-character record id names a board or a
 * card — every link minted before keys existed spells a card that way — so
 * both are asked of the local collections, and a card answers with the page
 * URL it now lives at (`legacyCardPath`) for the screen to redirect to.
 */
export interface BoardRoute {
    project: BoardProject | null
    /** The card the URL names on this board, or '' when it names only a board. */
    cardId: string
    /** True until the board — and the card, if the URL names one — can be judged absent. */
    isLoading: boolean
    /** The board's canonical URL segment: its slug, or its id when it has none. */
    segment: string
    /**
     * Whether the board is archived. From the raw row rather than the built
     * tree: archived is a property of the board's PLACE in the sidebar, not
     * of its contents.
     */
    isArchived: boolean
    /** Live cards across the board before the reader's filter, for the header. */
    cardCount: number
    /** Set when the segment is a CARD's record id: the page path it now lives at. */
    legacyCardPath: string | null
}

interface UseBoardRouteOptions {
    /**
     * The `?focused=` value. Core mints that param generically for EVERY
     * package (core/server/notify/comment_mentions.go), and it is also the
     * spelling a card with no key falls back to — see lib/board-route.ts.
     */
    focused?: string
    /** Applies the reader's filter, sort and scope. Off for the full-page card. */
    isViewed?: boolean
}

export function useBoardRoute(
    routeSegment: string,
    cardSegment = '',
    { focused = '', isViewed = true }: UseBoardRouteOptions = {}
): BoardRoute {
    const [projectsCollection, cardsCollection] = useStore('boards_projects', 'boards_cards')

    const { slug } = useMemo(() => parseBoardSegment(routeSegment), [routeSegment])

    // By id OR by slug in one query, so a board resolves the moment its
    // OPTIMISTIC row lands — the instant it is created — rather than after a
    // round trip, and a link by record id keeps working for a board that
    // never had a slug.
    const { data: projectRows, isLoading: projectLoading } = useBoardLiveQuery(
        query => {
            if (!routeSegment) return null
            return query
                .from({ project: projectsCollection })
                .where(({ project }) => or(eq(project.id, routeSegment), eq(project.slug, slug)))
        },
        [routeSegment, slug, projectsCollection]
    )
    const projectRow = projectRows?.[0]
    const projectId = projectRow?.id ?? ''

    // A record id may instead be a CARD, which is what every link minted before
    // keys existed spells. Asked as a query rather than a `.get()` so a cold
    // load waits for the collection to sync instead of flashing "no such board".
    const mayBeCardId = !parseCardKey(routeSegment) && isRecordId(routeSegment)
    const { data: legacyCardRows, isLoading: legacyCardLoading } = useBoardLiveQuery(
        query => {
            if (!mayBeCardId) return null
            return query
                .from({ card: cardsCollection })
                .where(({ card }) => eq(card.id, routeSegment))
        },
        [mayBeCardId, routeSegment, cardsCollection]
    )
    const legacyCard = legacyCardRows?.[0]
    const legacyCardPath = useMemo(() => {
        if (!legacyCard) return null
        const owner = projectsCollection.get(legacyCard.project)
        const segment = owner ? boardSegment(owner) : legacyCard.project
        return cardPagePath(segment, legacyCard.number)
    }, [legacyCard, projectsCollection])

    // The reader's view, applied only where a view exists. The full-page card
    // renders one card and must not be filtered out from under itself.
    const filter = useBoardsUIStore(s => selectBoardFilter(s, projectId))
    const sort = useBoardsUIStore(s => selectBoardSort(s, projectId))
    const storedScope = useBoardsUIStore(s => selectSprintScope(s, projectId))
    const sprintsEnabled = projectRow?.sprints_enabled ?? false
    const viewMode = useBoardsUIStore(s => selectViewMode(s, projectId, sprintsEnabled))
    const { user } = useAuth({ throwIfAnon: false })
    const userId = user?.id ?? ''
    const view = useMemo<BoardViewOptions | undefined>(
        () =>
            isViewed
                ? { filter, sort, userId, sprintScope: scopeForView(viewMode, storedScope) }
                : undefined,
        [isViewed, filter, sort, userId, storedScope, viewMode]
    )

    const { project, cardCount, isLoading: contentLoading } = useBoardContent(projectId, view)

    // `/a/boards/PL/12` carries the number alone; `/a/boards/PL-12` and
    // `?focused=` carry a key or an id. Both resolve to a RECORD ID here, so
    // everything downstream — findCardEntry, the presence room, the j/k
    // stepper — keeps working on ids and never learns that keys exist.
    const cardNumber = parseCardNumber(cardSegment)
    const urlCard = urlCardParam(routeSegment, focused)
    const cardId = useMemo(() => {
        if (!project) return ''
        if (cardSegment) return cardNumber ? findByNumber(project, cardNumber) : ''
        return resolveCardOnBoard(project, urlCard)
    }, [project, cardSegment, cardNumber, urlCard])

    return {
        project,
        cardId,
        // A card needs the board's cards to have landed before "no such card"
        // can be true; without that a deep link flashes not-found on every
        // cold load.
        isLoading: projectLoading || legacyCardLoading || contentLoading,
        segment: projectRow ? boardSegment(projectRow) : '',
        isArchived: projectRow?.archived ?? false,
        cardCount,
        legacyCardPath,
    }
}

/** A card by its number on THIS board, so `/PL/12` cannot reach card 12 of another. */
function findByNumber(project: BoardProject, cardNumber: number): string {
    for (const { card } of flattenCards(project)) {
        if (card.number === cardNumber) return card.id
    }
    return ''
}
