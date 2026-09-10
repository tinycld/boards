import { and, eq } from '@tanstack/db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'

/**
 * One card's live PR links.
 *
 * Tombstoned rows are filtered here rather than deleted in the database: a
 * link derived from a branch name comes back on the next delivery, so removal
 * has to be a flag rather than a row deletion. See pb-migrations/1980000021.
 */
export function usePrLinks(cardId: string) {
    const [prLinksCollection] = useStore('boards_pr_links')

    return useOrgLiveQuery(
        query =>
            query
                .from({ link: prLinksCollection })
                .where(({ link }) => and(eq(link.card, cardId), eq(link.unlinked, false)))
                .orderBy(({ link }) => link.number),
        [cardId]
    )
}
