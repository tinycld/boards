import { useMemo } from 'react'
import { useCardChildren } from './useCardDetail'

/**
 * One card's live PR links, in PR-number order.
 *
 * The rows come with the card's one request (useCardChildren). Tombstoned
 * rows are filtered here rather than deleted in the database: a link derived
 * from a branch name comes back on the next delivery, so removal has to be a
 * flag rather than a row deletion. See pb-migrations/1980000021.
 */
export function usePrLinks(cardId: string) {
    const rows = useCardChildren(cardId).children?.prLinks
    const data = useMemo(
        () => (rows ?? []).filter(link => !link.unlinked).sort((a, b) => a.number - b.number),
        [rows]
    )
    return { data }
}
