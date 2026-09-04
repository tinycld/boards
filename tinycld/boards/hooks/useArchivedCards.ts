import { and, eq } from '@tanstack/db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useMemo } from 'react'
import { buildArchivedCards } from '../lib/archived-cards'
import type { BoardProject } from '../types'
import { useBoardLiveQuery } from './useBoardLiveQuery'

/**
 * A board's archived cards, live.
 *
 * `boards_cards` syncs eagerly across every board the user belongs to and the
 * rows never leave the local store on archive — `buildBoardProject` merely
 * skips them — so this is a local filter, not a fetch. The list names come
 * from the board tree the caller already holds rather than a second query.
 */
export function useArchivedCards(project: BoardProject) {
    const [cardsCollection] = useStore('boards_cards')
    const { data: rows } = useBoardLiveQuery(
        query =>
            query
                .from({ card: cardsCollection })
                .where(({ card }) => and(eq(card.project, project.id), eq(card.archived, true))),
        [project.id, cardsCollection]
    )
    return useMemo(
        () => buildArchivedCards(rows ?? [], project.lists, project.slug),
        [rows, project.lists, project.slug]
    )
}
