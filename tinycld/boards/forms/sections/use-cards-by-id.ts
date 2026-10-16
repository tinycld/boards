import { useMemo } from 'react'
import type { BoardCardView } from '../../types'

/**
 * This board's cards by id, for resolving a link's far end. Only this
 * board's, which is the point: a cross-board link's far card is absent here
 * and renders redacted (lib/card-links.ts).
 */
export function useCardsById(projectCards: BoardCardView[]) {
    return useMemo(() => new Map(projectCards.map(entry => [entry.id, entry])), [projectCards])
}
