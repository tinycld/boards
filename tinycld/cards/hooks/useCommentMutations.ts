import type { Transaction } from '@tanstack/react-db'
import { useAuth } from '@tinycld/core/lib/auth'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { stores, useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'
import { buildCommentMentionRows } from '../lib/mention-text'

// `comment_mentions` is the SHARED mentions table, and it is registered by
// @tinycld/drive (which owns its migration), not by core. A workspace can
// install cards without drive — so this is looked up on the store map rather
// than through `useStore('comment_mentions')`, which assumes the collection is
// there. Absent, mentions simply do not notify: comments still post, the token
// still renders as a name, and nothing throws. That is the lean-shell
// guarantee, and it is why cards declares no dependency on drive.
//
// Deliberately NOT a hard import of @tinycld/drive: that would make the
// dependency load-bearing at compile time (CLAUDE.md, "Cross-package coupling").
const mentionsCollection = () =>
    (stores as Record<string, unknown>).comment_mentions as
        | { insert: (row: Record<string, unknown>) => Transaction<Record<string, unknown>> }
        | undefined

export interface CreateCommentInput {
    body: string
    /** The comment being replied to, or '' for a top-level comment. */
    parent?: string
}

/**
 * Comment mutations for one card.
 *
 * `author` is sent even though the create rule PINS it to the authenticated
 * user server-side: the rule requires the submitted value to match, so omitting
 * it is a rejected write rather than a defaulted one.
 *
 * Note what the rules allow, because the UI must not offer more: a comment may
 * be edited only by its author AND only while they still hold commenting
 * standing on the board, and deleted by its author or a project owner. A
 * demoted user cannot keep editing their old comments.
 */
export function useCommentMutations(cardId: string, projectId: string) {
    // Non-throwing: BoardColumn calls the mutation hooks unconditionally, so
    // they are constructed on the PUBLIC board too — where there is no
    // session and the affordances that would invoke them are already gated
    // off. Throwing here made merely RENDERING a shared board an error.
    const { user } = useAuth({ throwIfAnon: false })
    const [commentsCollection] = useStore('cards_comments')

    const createComment = useMutation<string, Error, CreateCommentInput>({
        mutationKey: ['cards', 'comment', 'create'],
        mutationFn: mutation(function* (input: CreateCommentInput) {
            const commentId = newRecordId()
            yield commentsCollection.insert({
                id: commentId,
                card: cardId,
                project: projectId,
                author: user?.id ?? '',
                body: input.body,
                parent: input.parent ?? '',
            })

            // One comment_mentions row per distinct `[[@id]]` in the body. The
            // Go hook (core/server/notify/comment_mentions.go) observes those
            // inserts and notifies; clients never read this table.
            //
            // Yielded AFTER the comment so the row it references exists — the
            // notify hook resolves `comment_record` to read the author and
            // body, and would drop the mention if it arrived first.
            //
            // `target_collection`/`target_record` point at the CARD, not the
            // comment: a mention is about the card you are being called to, and
            // the deep-link opens it. `drive_item` is deliberately '' — cards
            // has no drive items, which is the whole reason core generalized
            // this table (migration 1985000002).
            // Self-mentions are dropped by buildCommentMentionRows: the picker
            // already excludes you, so a self-mention only arrives from a
            // hand-typed token — and the Go hook drops it again server-side.
            const mentions = mentionsCollection()
            if (mentions) {
                const rows = buildCommentMentionRows({
                    body: input.body,
                    commentId,
                    cardId,
                    authorId: user?.id ?? '',
                })
                for (const row of rows) {
                    yield mentions.insert({ id: newRecordId(), ...row })
                }
            }
            return commentId
        }),
    })

    // NO mention inserts on edit, matching core's own comment factory
    // (lib/comments/mutations.ts notifies on add/reply only). Adding someone by
    // editing an existing comment therefore does not notify them. That is a
    // real gap rather than a considered feature — it is inherited deliberately
    // so cards and the document packages behave identically, and fixing it
    // belongs in core where both would get it. Note the DESCRIPTION path does
    // not share the limitation: it diffs against the stored text on every
    // flush, so a mention added by editing does notify there.
    const updateComment = useMutation<void, Error, { commentId: string; body: string }>({
        mutationKey: ['cards', 'comment', 'update'],
        mutationFn: mutation(function* ({ commentId, body }) {
            yield commentsCollection.update(commentId, draft => {
                draft.body = body
            })
        }),
    })

    const deleteComment = useMutation<void, Error, string>({
        mutationKey: ['cards', 'comment', 'delete'],
        mutationFn: mutation(function* (commentId: string) {
            yield commentsCollection.delete(commentId)
        }),
    })

    return { createComment, updateComment, deleteComment }
}
