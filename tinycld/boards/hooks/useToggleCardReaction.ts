import { normalizeEmoji } from '@tinycld/core/lib/emoji/normalize'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'
import { useCallback } from 'react'
import type { ReactionGroup } from '../lib/reactions'

/**
 * The card-vote toggle, WITHOUT a query of its own.
 *
 * Split out of useCardReactions so the board face can offer the same toggle
 * every tile shares: the groups it needs to decide delete-vs-insert are
 * already folded by the board-wide useBoardCardReactions, so the caller passes
 * them in rather than this hook subscribing per card. A tile-level hook that
 * read its own rows would be one subscription per card on a board that can
 * hold hundreds — the exact cost useBoardCardReactions exists to avoid.
 *
 * useCardReactions composes this too, so the open card and the tile share one
 * toggle implementation rather than drifting apart.
 */
export function useToggleCardReaction(projectId: string, userId: string) {
    const [reactionsCollection] = useStore('boards_card_reactions')

    const toggle = useMutation<
        void,
        Error,
        { cardId: string; emoji: string; groups: readonly ReactionGroup[] }
    >({
        mutationKey: ['boards', 'card-reaction', 'toggle'],
        mutationFn: mutation(function* ({ cardId, emoji: raw, groups }) {
            // Normalize BEFORE the own-row lookup, not just before the insert:
            // stored rows are canonical, so a bare "❤" would fail to match the
            // stored "❤️" and this would try to insert a duplicate the unique
            // index then refuses.
            const emoji = normalizeEmoji(raw)
            if (emoji === null) {
                throw new Error(`${raw} is not an emoji this deployment stores`)
            }

            const own = groups.find(group => group.emoji === emoji)?.ownId
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

    // useCallback because BoardColumn's card stack is memoized — a re-render
    // mid-drag re-measures every item and corrupts the drop position, so this
    // identity is held stable exactly like reactionsForCard beside it.
    return useCallback(
        (cardId: string, emoji: string, groups: readonly ReactionGroup[]) =>
            toggle.mutate({ cardId, emoji, groups }),
        [toggle.mutate]
    )
}
