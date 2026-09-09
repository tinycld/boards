import { eq } from '@tanstack/db'
import { useAuth } from '@tinycld/core/lib/auth'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useMemo } from 'react'
import { groupCardReactions, type ReactionGroup } from '../lib/reactions'
import { useBoardLiveQuery } from './useBoardLiveQuery'
import { useToggleCardReaction } from './useToggleCardReaction'

const NO_REACTIONS: ReactionGroup[] = []

/**
 * Votes on the open card, and the toggle.
 *
 * The comment-reactions shape one level up: one query, folded in render, and
 * a toggle that inserts or deletes the caller's OWN row only — the rules
 * refuse anything else.
 *
 * The toggle itself lives in useToggleCardReaction so the board face can
 * share it; this hook supplies the per-card groups it needs. That is sound
 * HERE because the detail view has exactly one card open — the board face
 * passes the groups it already folded board-wide instead.
 *
 * useBoardLiveQuery because a share-link visitor reads this with no session.
 */
export function useCardReactions(projectId: string, cardId: string) {
    const [reactionsCollection] = useStore('boards_card_reactions')
    // Non-throwing: cards render on the public board, where there is no
    // session and the bar is read-only.
    const { user } = useAuth({ throwIfAnon: false })
    const userId = user?.id ?? ''

    const { data: rows } = useBoardLiveQuery(
        query => {
            if (!cardId) return null
            return query
                .from({ reaction: reactionsCollection })
                .where(({ reaction }) => eq(reaction.card, cardId))
        },
        [cardId]
    )
    const byCard = useMemo(() => groupCardReactions(rows ?? [], userId), [rows, userId])
    const reactions = byCard.get(cardId) ?? NO_REACTIONS
    const toggle = useToggleCardReaction(projectId, userId)

    return {
        reactions,
        toggleReaction: (emoji: string) => toggle(cardId, emoji, reactions),
    }
}
