import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { CommentComposer } from '../../components/detail/CommentComposer'
import { useCardDetail } from '../../hooks/useCardDetail'
import { useCommentMutations } from '../../hooks/useCommentMutations'
import { useProjectRole } from '../../hooks/useProjectRole'
import { useCommentReplyStore } from '../../stores/comment-reply-store'
import { type CardFormValue, useAdapterData } from '../CardFormContext'

/** The comment composer. Commentors keep it — that is what the role means. */
export function CommentsSection({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    if (data?.mode !== 'card' || disabled) return null
    return <Comments data={data} />
}

function Comments({ data }: { data: CardFormValue }) {
    const { card, projectId } = data
    const { canComment } = useProjectRole(projectId)
    const { attachments } = useCardDetail(card.id)
    const { createComment } = useCommentMutations(card.id, projectId)
    const replyTarget = useCommentReplyStore(s => s.replyingTo)
    const cancelReply = useCommentReplyStore(s => s.cancelReply)
    const replyingTo = replyTarget?.cardId === card.id ? replyTarget : undefined

    const submitComment = (body: string) =>
        createComment.mutate({ body, parent: replyingTo?.id ?? '' }, { onSuccess: cancelReply })

    if (!canComment) return null
    return (
        <CommentComposer
            widthClass=""
            cardId={card.id}
            projectId={projectId}
            attachments={attachments}
            onSubmit={submitComment}
            isPending={createComment.isPending}
            replyingTo={replyingTo}
            onCancelReply={cancelReply}
        />
    )
}
