import { useAuth } from '@tinycld/core/lib/auth'
import { useMemo } from 'react'
import type { ReactionGroup } from '../lib/reactions'
import { useBoardCardReactions } from './useBoardCardReactions'
import { useToggleCardReaction } from './useToggleCardReaction'

const NO_REACTIONS: ReactionGroup[] = []

/**
 * Votes on the open card, and the toggle.
 *
 * Read out of the BOARD's reaction rows (useBoardCardReactions), which load
 * with the board and are served from the store: a per-card subset (`card =`)
 * is not one the project fetch marked, so asking by card would be a request
 * for rows already in memory.
 *
 * The toggle itself lives in useToggleCardReaction so the board face can
 * share it; this hook supplies the per-card groups it needs.
 */
export function useCardReactions(projectId: string, cardId: string) {
    // Non-throwing: cards render on the public board, where there is no
    // session and the bar is read-only.
    const { user } = useAuth({ throwIfAnon: false })
    const userId = user?.id ?? ''

    const { reactionsForCard } = useBoardCardReactions(projectId)
    const reactions = useMemo(
        () => (cardId ? reactionsForCard(cardId) : NO_REACTIONS),
        [reactionsForCard, cardId]
    )
    const toggle = useToggleCardReaction(projectId, userId)

    return {
        reactions,
        toggleReaction: (emoji: string) => toggle(cardId, emoji, reactions),
    }
}
