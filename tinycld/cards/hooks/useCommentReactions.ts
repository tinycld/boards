import { eq } from '@tanstack/db'
import { useAuth } from '@tinycld/core/lib/auth'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { newRecordId } from 'pbtsdb/core'
import { useMemo } from 'react'
import { groupReactions, type ReactionEmoji, type ReactionGroup } from '../lib/reactions'

const NO_REACTIONS: ReactionGroup[] = []

/**
 * Every reaction on the open card, folded per comment, and the toggle.
 *
 * ONE live query for the card, not one per comment, and deliberately not a
 * fifth join inside useCardDetail: that query is already a four-way product
 * of the card's children, and reactions are the one child that scales with
 * comments × people. The rows are cheap to fold in render.
 *
 * The toggle inserts or deletes the caller's OWN row only — the rules refuse
 * anything else, the watchers shape. `project` and `card` are written
 * explicitly on every insert: the rules resolve membership through the one
 * and pin the other.
 */
export function useCommentReactions(projectId: string, cardId: string) {
    const [reactionsCollection] = useStore('cards_comment_reactions')
    // Non-throwing: comments render on the public board, where there is no
    // session and the bar is read-only.
    const { user } = useAuth({ throwIfAnon: false })
    const userId = user?.id ?? ''

    const { data: rows } = useOrgLiveQuery(
        query => {
            if (!cardId) return null
            return query
                .from({ reaction: reactionsCollection })
                .where(({ reaction }) => eq(reaction.card, cardId))
        },
        [cardId]
    )
    const byComment = useMemo(() => groupReactions(rows ?? [], userId), [rows, userId])

    const toggle = useMutation<void, Error, { commentId: string; emoji: ReactionEmoji }>({
        mutationKey: ['cards', 'reaction', 'toggle'],
        mutationFn: mutation(function* ({ commentId, emoji }) {
            const own = byComment.get(commentId)?.find(group => group.emoji === emoji)?.ownId
            if (own) {
                yield reactionsCollection.delete(own)
                return
            }
            yield reactionsCollection.insert({
                id: newRecordId(),
                project: projectId,
                card: cardId,
                comment: commentId,
                user: userId,
                emoji,
            })
        }),
    })

    return {
        reactionsFor: (commentId: string) => byComment.get(commentId) ?? NO_REACTIONS,
        toggleReaction: (commentId: string, emoji: ReactionEmoji) =>
            toggle.mutate({ commentId, emoji }),
    }
}
