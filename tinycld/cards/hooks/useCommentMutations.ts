import { useAuth } from '@tinycld/core/lib/auth'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'

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
            return commentId
        }),
    })

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
