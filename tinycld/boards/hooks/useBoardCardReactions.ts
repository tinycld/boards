import { eq } from '@tanstack/db'
import { useAuth } from '@tinycld/core/lib/auth'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useCallback, useMemo } from 'react'
import { groupCardReactions, type ReactionGroup } from '../lib/reactions'
import { useBoardLiveQuery } from './useBoardLiveQuery'

const NO_REACTIONS: ReactionGroup[] = []

/**
 * Every card's votes for the whole board, folded per card.
 *
 * ONE query keyed by `project`, not one per card — a board can hold hundreds
 * of tiles, and a query each would be that many subscriptions. The rows
 * arrive with the board's own request (`boards_card_reactions_via_project`,
 * see collections.ts), so this single-field subset is served from the store;
 * the migration's project index exists for the server side of that read.
 *
 * useBoardLiveQuery, not useMyLiveQuery: the board face is exactly the screen
 * a share-link visitor sees with no session, and useMyLiveQuery returns null
 * whenever the user id is empty.
 */
export function useBoardCardReactions(projectId: string) {
    const [reactionsCollection] = useStore('boards_card_reactions')
    const { user } = useAuth({ throwIfAnon: false })
    const userId = user?.id ?? ''

    const { data: rows } = useBoardLiveQuery(query => {
        if (!projectId) return null
        return query
            .from({ reaction: reactionsCollection })
            .where(({ reaction }) => eq(reaction.project, projectId))
    })
    const byCard = useMemo(() => groupCardReactions(rows ?? [], userId), [rows, userId])

    // useCallback, and NO_REACTIONS is a module constant rather than a fresh
    // []: BoardColumn's card stack is memoized because a re-render mid-drag
    // re-measures every item and corrupts the drop position. A new closure or
    // a new empty array each render would defeat that memo on every board
    // update, so both identities are held stable.
    const reactionsForCard = useCallback(
        (cardId: string) => byCard.get(cardId) ?? NO_REACTIONS,
        [byCard]
    )

    return { reactionsForCard }
}
