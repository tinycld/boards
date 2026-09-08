import { eq } from '@tanstack/db'
import { useAuth } from '@tinycld/core/lib/auth'
import { normalizeEmoji } from '@tinycld/core/lib/emoji/normalize'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'
import { useMemo } from 'react'
import { groupCommentReactions, type ReactionGroup } from '../lib/reactions'
import { useBoardLiveQuery } from './useBoardLiveQuery'

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
    const [reactionsCollection] = useStore('boards_comment_reactions')
    // Non-throwing: comments render on the public board, where there is no
    // session and the bar is read-only.
    const { user } = useAuth({ throwIfAnon: false })
    const userId = user?.id ?? ''

    // useBoardLiveQuery, NOT useOrgLiveQuery: the latter returns null when
    // there is no signed-in user, which is exactly the public-board case this
    // hook's own header says it serves — reactions were silently absent for
    // share-link visitors. The query filters by card, never by user, so
    // dropping the guard changes what is requested, never what is permitted.
    const { data: rows } = useBoardLiveQuery(
        query => {
            if (!cardId) return null
            return query
                .from({ reaction: reactionsCollection })
                .where(({ reaction }) => eq(reaction.card, cardId))
        },
        [cardId]
    )
    const byComment = useMemo(() => groupCommentReactions(rows ?? [], userId), [rows, userId])

    const toggle = useMutation<void, Error, { commentId: string; emoji: string }>({
        mutationKey: ['boards', 'reaction', 'toggle'],
        mutationFn: mutation(function* ({ commentId, emoji: raw }) {
            // Normalize BEFORE the own-row lookup, not just before the insert:
            // stored rows are canonical, so a bare "❤" would fail to match the
            // stored "❤️" and this would try to insert a duplicate the unique
            // index then refuses. The server refuses a non-canonical value
            // outright (server/reaction_emoji.go), so a miss here is a bug
            // worth failing on rather than passing along.
            const emoji = normalizeEmoji(raw)
            if (emoji === null) {
                throw new Error(`${raw} is not an emoji this deployment stores`)
            }

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
        toggleReaction: (commentId: string, emoji: string) => toggle.mutate({ commentId, emoji }),
    }
}
