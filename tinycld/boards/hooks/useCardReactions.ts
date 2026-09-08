import { eq } from '@tanstack/db'
import { useAuth } from '@tinycld/core/lib/auth'
import { normalizeEmoji } from '@tinycld/core/lib/emoji/normalize'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'
import { useMemo } from 'react'
import { groupCardReactions, type ReactionGroup } from '../lib/reactions'
import { useBoardLiveQuery } from './useBoardLiveQuery'

const NO_REACTIONS: ReactionGroup[] = []

/**
 * Votes on the open card, and the toggle.
 *
 * The comment-reactions shape one level up: one query, folded in render, and
 * a toggle that inserts or deletes the caller's OWN row only — the rules
 * refuse anything else.
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

    const toggle = useMutation<void, Error, { emoji: string }>({
        mutationKey: ['boards', 'card-reaction', 'toggle'],
        mutationFn: mutation(function* ({ emoji: raw }) {
            // Normalize BEFORE the own-row lookup, not just before the insert:
            // stored rows are canonical, so a bare "❤" would fail to match the
            // stored "❤️" and this would try to insert a duplicate the unique
            // index then refuses.
            const emoji = normalizeEmoji(raw)
            if (emoji === null) {
                throw new Error(`${raw} is not an emoji this deployment stores`)
            }

            const own = byCard.get(cardId)?.find(group => group.emoji === emoji)?.ownId
            if (own) {
                yield reactionsCollection.delete(own)
                return
            }
            yield reactionsCollection.insert({
                id: newRecordId(),
                project: projectId,
                card: cardId,
                user: userId,
                emoji,
            })
        }),
    })

    return {
        reactions: byCard.get(cardId) ?? NO_REACTIONS,
        toggleReaction: (emoji: string) => toggle.mutate({ emoji }),
    }
}
