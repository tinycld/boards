import { create } from '@tinycld/core/lib/store'

export interface ReplyTarget {
    /** The card the reply belongs to, so a target never follows the reader to another card. */
    cardId: string
    id: string
    authorName: string
}

interface CommentReplyState {
    replyingTo: ReplyTarget | null
    startReply: (target: ReplyTarget) => void
    cancelReply: () => void
}

/**
 * Which comment the composer is replying to.
 *
 * Shared UI state between two sections of the card's form: the activity list
 * sets it (Reply on a comment) and the comment composer reads it. The form
 * renderer owns the tree between them, so neither can hold it for the other.
 * Transient, never persisted.
 */
export const useCommentReplyStore = create<CommentReplyState>()(set => ({
    replyingTo: null,
    startReply: target => set({ replyingTo: target }),
    cancelReply: () => set({ replyingTo: null }),
}))
