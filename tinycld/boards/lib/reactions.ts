// Reactions: the boards-specific half.
//
// The fold, the chip model and the UI are core's
// (@tinycld/core/lib/reactions/group, @tinycld/core/ui/reactions) — none of
// it is specific to a board. What lives here is how THIS package keys its two
// reactions tables, and how it turns a user id into a name.

import { parseNativeEmoji } from '@tinycld/core/lib/emoji/parse'
import { groupReactions, type ReactionGroup } from '@tinycld/core/lib/reactions/group'
import type { BoardMember, BoardsCardReactions, BoardsCommentReactions } from '../types'
import { anonymousMember } from './board-project'

export { reactionKey } from '@tinycld/core/lib/reactions/group'
export type { ReactionGroup }

/** The inverse of reactionKey, for turning a stored key back into a glyph. */
export function reactionFromKey(key: string): string {
    return parseNativeEmoji(key)
}

type CommentReactionRow = Pick<BoardsCommentReactions, 'id' | 'comment' | 'user' | 'emoji'>
type CardReactionRow = Pick<BoardsCardReactions, 'id' | 'card' | 'user' | 'emoji'>

/** Comment reactions, folded per comment. */
export function groupCommentReactions(rows: readonly CommentReactionRow[], userId: string) {
    return groupReactions(rows, userId, row => row.comment)
}

/** Card votes, folded per card. */
export function groupCardReactions(rows: readonly CardReactionRow[], userId: string) {
    return groupReactions(rows, userId, row => row.card)
}

/**
 * A name lookup for the chip tooltip.
 *
 * Falls back to anonymousMember for an id the caller cannot resolve — a
 * share-link visitor can read reactions but not the `users` rows behind them,
 * and this is the same "Board member" placeholder assignees already use, so
 * the tooltip discloses nothing new.
 */
export function reactorNameLookup(
    membersById: ReadonlyMap<string, BoardMember>
): (userId: string) => string {
    return userId => {
        const member = membersById.get(userId) ?? anonymousMember(userId)
        return `${member.firstName} ${member.lastName}`.trim()
    }
}
