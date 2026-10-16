import { useAuth } from '@tinycld/core/lib/auth'
import { useMemo } from 'react'
import type { BoardViewOptions } from '../lib/board-project'
import { boardSegment, parseBoardSegment } from '../lib/board-route'
import {
    selectBoardFilter,
    selectBoardSort,
    selectSprintScope,
    selectViewMode,
    useBoardsUIStore,
} from '../stores/boards-ui-store'
import type { BoardProject } from '../types'
import { scopeForView, useBoardRows, useBoardTree } from './useActiveBoard'

/**
 * Resolve `/a/boards/<segment>` to a board. The card a child route names is
 * resolved against this board by useOpenCard.
 *
 * THE URL IS THE SOURCE OF TRUTH for which board is on screen. The board used
 * to live only in Zustand, which made it unlinkable — a pasted link landed on
 * whichever board the reader had open last. Nothing here reads the store to
 * decide what to render; the screen writes the store afterwards so the bare
 * `/a/boards` can return to where the reader was.
 *
 * The segment shapes are documented in lib/board-route.ts.
 */
export interface BoardRoute {
    project: BoardProject | null
    /**
     * The same board with every live card, in board order and before the
     * reader's view. What a card is resolved against: the filter decides
     * which faces the board shows, not which card a peek or a page may open.
     */
    fullProject: BoardProject | null
    /** True until the board and its cards can be judged absent. */
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
}

export function useBoardRoute(routeSegment: string): BoardRoute {
    const slug = useMemo(() => parseBoardSegment(routeSegment).slug, [routeSegment])

    // By id OR by slug in the board's one query, so a board resolves the
    // moment its OPTIMISTIC row lands — the instant it is created — rather
    // than after a round trip, and a link by record id keeps working for a
    // board that never had a slug. The rows and the tree are two calls here
    // rather than one useBoardContent because the reader's view below is
    // keyed by the project id the rows resolve.
    const rows = useBoardRows({ segment: routeSegment, slug })
    const projectRow = rows.rows?.project
    const projectId = projectRow?.id ?? ''

    // The reader's view: filter, sort and sprint scope.
    const filter = useBoardsUIStore(s => selectBoardFilter(s, projectId))
    const sort = useBoardsUIStore(s => selectBoardSort(s, projectId))
    const storedScope = useBoardsUIStore(s => selectSprintScope(s, projectId))
    const sprintsEnabled = projectRow?.sprints_enabled ?? false
    const viewMode = useBoardsUIStore(s => selectViewMode(s, projectId, sprintsEnabled))
    const { user } = useAuth({ throwIfAnon: false })
    const userId = user?.id ?? ''
    const view = useMemo<BoardViewOptions>(
        () => ({ filter, sort, userId, sprintScope: scopeForView(viewMode, storedScope) }),
        [filter, sort, userId, storedScope, viewMode]
    )

    const { project, cardCount, isLoading: contentLoading } = useBoardTree(rows, view)
    const { project: fullProject } = useBoardTree(rows)

    return {
        project,
        fullProject,
        // A card child needs the board's cards to have landed before "no such
        // card" can be true; without that a deep link flashes not-found on
        // every cold load.
        isLoading: contentLoading,
        segment: projectRow ? boardSegment(projectRow) : '',
        isArchived: projectRow?.archived ?? false,
        cardCount,
    }
}
