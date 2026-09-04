// Comment reactions: the palette, and how a card's reaction rows fold into
// the per-comment bar.
//
// The schema (pb-migrations/1980000013) fixes the six emoji; this module
// fixes their order and their names, so the bar renders in one stable order
// however the rows arrive and every chip has an accessible name.

import type { BoardsCommentReactions } from '../types'

export const REACTION_PALETTE = ['👍', '❤️', '😄', '🎉', '👀', '🚀'] as const

export type ReactionEmoji = (typeof REACTION_PALETTE)[number]

/** Stable, ASCII names — for accessibility labels and test ids. */
export const REACTION_KEYS: Record<ReactionEmoji, string> = {
    '👍': 'thumbs_up',
    '❤️': 'heart',
    '😄': 'laugh',
    '🎉': 'party',
    '👀': 'eyes',
    '🚀': 'rocket',
}

export const REACTION_LABELS: Record<ReactionEmoji, string> = {
    '👍': 'Thumbs up',
    '❤️': 'Heart',
    '😄': 'Laugh',
    '🎉': 'Party',
    '👀': 'Eyes',
    '🚀': 'Rocket',
}

export function isReactionEmoji(raw: string): raw is ReactionEmoji {
    return REACTION_PALETTE.includes(raw as ReactionEmoji)
}

export interface ReactionGroup {
    emoji: ReactionEmoji
    count: number
    /** The caller's own row for this emoji, so a toggle can delete without a lookup. */
    ownId: string | null
}

type ReactionRow = Pick<BoardsCommentReactions, 'id' | 'comment' | 'user' | 'emoji'>

/**
 * Rows → one group per (comment, emoji), in palette order. A comment with no
 * reactions has no entry. An emoji outside the palette can only arrive
 * through a schema edit and is dropped rather than rendered nameless.
 */
export function groupReactions(
    rows: readonly ReactionRow[],
    userId: string
): Map<string, ReactionGroup[]> {
    const byComment = new Map<string, Map<ReactionEmoji, ReactionGroup>>()
    for (const row of rows) {
        if (!isReactionEmoji(row.emoji)) continue
        let groups = byComment.get(row.comment)
        if (!groups) {
            groups = new Map()
            byComment.set(row.comment, groups)
        }
        let group = groups.get(row.emoji)
        if (!group) {
            group = { emoji: row.emoji, count: 0, ownId: null }
            groups.set(row.emoji, group)
        }
        group.count += 1
        if (userId !== '' && row.user === userId) group.ownId = row.id
    }

    const out = new Map<string, ReactionGroup[]>()
    for (const [commentId, groups] of byComment) {
        const ordered = REACTION_PALETTE.flatMap(emoji => {
            const group = groups.get(emoji)
            return group ? [group] : []
        })
        out.set(commentId, ordered)
    }
    return out
}
