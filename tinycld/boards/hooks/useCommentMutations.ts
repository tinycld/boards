import { useAuth } from '@tinycld/core/lib/auth'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'
import { buildCommentMentionRows } from '../lib/mention-text'

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
    // `comment_mentions` is the SHARED mentions table — core's, on every
    // assembly (core creates it in 1985000003 and registers the store
    // unconditionally). This was a soft lookup on the raw store map while the
    // registration was drive's, and the fallback's "mentions simply do not
    // notify" degradation is exactly what boards' single-package CI caught
    // running for real: comments posted, tokens rendered, nobody notified.
    const [commentsCollection, mentionsCollection] = useStore('boards_comments', 'comment_mentions')

    const createComment = useMutation<string, Error, CreateCommentInput>({
        mutationKey: ['boards', 'comment', 'create'],
        mutationFn: mutation(function* (input: CreateCommentInput) {
            const commentId = newRecordId()
            yield commentsCollection.insert({
                id: commentId,
                card: cardId,
                project: projectId,
                author: user?.id ?? '',
                body: input.body,
                parent: input.parent ?? '',
                // Never edited. Server-owned thereafter — see comment_edited.go.
                edited_at: '',
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
            const rows = buildCommentMentionRows({
                body: input.body,
                commentId,
                cardId,
                authorId: user?.id ?? '',
            })
            for (const row of rows) {
                yield mentionsCollection.insert({ id: newRecordId(), ...row })
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
        mutationKey: ['boards', 'comment', 'update'],
        mutationFn: mutation(function* ({ commentId, body }) {
            yield commentsCollection.update(commentId, draft => {
                draft.body = body
                // Optimistic only: the server hook (comment_edited.go) owns
                // this column and re-stamps it authoritatively when the body
                // actually changed — setting it here just lets the "(edited)"
                // marker render without waiting on the round trip.
                draft.edited_at = new Date().toISOString()
            })
        }),
    })

    const deleteComment = useMutation<void, Error, string>({
        mutationKey: ['boards', 'comment', 'delete'],
        mutationFn: mutation(function* (commentId: string) {
            yield commentsCollection.delete(commentId)
        }),
    })

    return { createComment, updateComment, deleteComment }
}
