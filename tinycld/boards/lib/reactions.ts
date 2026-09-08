// Comment reactions: how a card's reaction rows fold into the per-comment bar.
//
// The palette used to be six emoji fixed by the schema, and this module owned
// their order and their names. The picker now offers the full set
// (@tinycld/core/ui/emoji-picker), so there is no palette to order by and no
// closed set to name from — what is left is the grouping, and an ordering
// rule that works for an open vocabulary.

import { parseNativeEmoji } from '@tinycld/core/lib/emoji/parse'
import type { BoardsCommentReactions } from '../types'

export interface ReactionGroup {
    emoji: string
    count: number
    /** The caller's own row for this emoji, so a toggle can delete without a lookup. */
    ownId: string | null
}

type ReactionRow = Pick<BoardsCommentReactions, 'id' | 'comment' | 'user' | 'emoji'>

/**
 * A stable per-emoji key for test ids and React keys.
 *
 * The unified codepoints rather than the glyph: a testID carrying a raw emoji
 * is painful to type in a selector and, for a ZWJ sequence, ambiguous to read.
 * Synchronous and total, so a chip never waits on the lazily-loaded table.
 */
export function reactionKey(emoji: string): string {
    return [...emoji].map(char => (char.codePointAt(0) ?? 0).toString(16)).join('-')
}

/** The inverse of reactionKey, for turning a stored key back into a glyph. */
export function reactionFromKey(key: string): string {
    return parseNativeEmoji(key)
}

/**
 * Rows -> one group per (comment, emoji).
 *
 * Ordered by count descending, then by the first row seen for that emoji.
 * There is no palette order to fall back on any more, and arrival order alone
 * would let a chip jump position as other people react. Ties break on first
 * appearance so the bar is stable while counts are equal.
 *
 * Every emoji is valid here: the server refuses anything it will not store
 * (server/reaction_emoji.go), so unlike the old palette check there is nothing
 * to filter out.
 */
export function groupReactions(
    rows: readonly ReactionRow[],
    userId: string
): Map<string, ReactionGroup[]> {
    const byComment = new Map<string, Map<string, ReactionGroup & { seq: number }>>()

    let seq = 0
    for (const row of rows) {
        let groups = byComment.get(row.comment)
        if (!groups) {
            groups = new Map()
            byComment.set(row.comment, groups)
        }
        let group = groups.get(row.emoji)
        if (!group) {
            group = { emoji: row.emoji, count: 0, ownId: null, seq: seq++ }
            groups.set(row.emoji, group)
        }
        group.count += 1
        if (userId !== '' && row.user === userId) group.ownId = row.id
    }

    const out = new Map<string, ReactionGroup[]>()
    for (const [commentId, groups] of byComment) {
        const ordered = [...groups.values()]
            .sort((a, b) => b.count - a.count || a.seq - b.seq)
            .map(({ seq: _seq, ...group }) => group)
        out.set(commentId, ordered)
    }
    return out
}
