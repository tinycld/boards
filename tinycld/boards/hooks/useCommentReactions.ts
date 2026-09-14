import { useAuth } from '@tinycld/core/lib/auth'
import { normalizeEmoji } from '@tinycld/core/lib/emoji/normalize'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'
import { useMemo } from 'react'
import { groupCommentReactions, type ReactionGroup } from '../lib/reactions'
import { useCardChildren } from './useCardDetail'

const NO_REACTIONS: ReactionGroup[] = []

/**
 * Every reaction on the open card, folded per comment, and the toggle.
 *
 * The rows come with the card's one request (useCardChildren) — one include
 * for the card, not a query per comment — and are cheap to fold in render.
 * Read with no user guard: comments render on the public board, where there
 * is no session and the bar is read-only.
 *
 * The toggle inserts or deletes the caller's OWN row only — the rules refuse
 * anything else, the watchers shape. `project` and `card` are written
 * explicitly on every insert: the rules resolve membership through the one
 * and pin the other.
 */
export function useCommentReactions(projectId: string, cardId: string) {
    const [reactionsCollection] = useStore('boards_comment_reactions')
    const { user } = useAuth({ throwIfAnon: false })
    const userId = user?.id ?? ''

    const rows = useCardChildren(cardId).children?.commentReactions
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
