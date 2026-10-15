import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { useMemo, useRef, useState } from 'react'
import { DetailActivity } from '../../components/detail/DetailActivity'
import { useCardDetail } from '../../hooks/useCardDetail'
import { useCommentMutations } from '../../hooks/useCommentMutations'
import { useCommentReactions } from '../../hooks/useCommentReactions'
import { useProjectRole } from '../../hooks/useProjectRole'
import { mentionMember } from '../../lib/mention-text'
import { useCommentReplyStore } from '../../stores/comment-reply-store'
import type { BoardComment } from '../../types'
import { type CardFormValue, useAdapterData } from '../CardFormContext'

/** The card's comments and history, interleaved. */
export function ActivitySection({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    if (!data) return null
    return <Activity data={data} disabled={disabled} />
}

function Activity({ data, disabled }: { data: CardFormValue; disabled: boolean }) {
    const { card, projectId, isOwner } = data
    const { comments, activity, attachments, isReady } = useCardDetail(card.id)
    const { canComment } = useProjectRole(projectId)
    const { updateComment, deleteComment } = useCommentMutations(card.id, projectId)
    // Read out of the card's one query (useCardChildren) — see the hook.
    const { reactionsFor, toggleReaction } = useCommentReactions(projectId, card.id)
    const startReply = useCommentReplyStore(s => s.startReply)
    const activityContext = useActivityContext(data)
    // The roster as mention labels, once for every comment — MarkdownText
    // renders per comment and must not query.
    const mentionMembers = useMemo(
        () => data.projectMembers.map(mentionMember),
        [data.projectMembers]
    )
    const { editingCommentId, editStartPoint, startEdit, cancelEdit, closeEdit } = useCommentEdit()

    const saveComment = (commentId: string, body: string) => {
        // The update is optimistic, so the new body renders at once; failures
        // surface through the mutation.
        updateComment.mutate({ commentId, body })
        closeEdit(commentId)
    }
    const reply = (comment: BoardComment) =>
        startReply({
            cardId: card.id,
            id: comment.id,
            authorName: comment.author.firstName || 'this comment',
        })

    return (
        <DetailActivity
            comments={comments}
            activity={activity}
            activityContext={activityContext}
            // Not before the children query settles: an empty result then
            // cannot be told from a card with no comments.
            canComment={canComment && isReady && !disabled}
            canModerate={isOwner}
            reactionsFor={reactionsFor}
            onToggleReaction={toggleReaction}
            cardId={card.id}
            projectId={projectId}
            attachments={attachments}
            mentionMembers={mentionMembers}
            editingCommentId={editingCommentId}
            isSaving={updateComment.isPending}
            onStartEdit={startEdit}
            editStartPoint={editStartPoint}
            onCancelEdit={cancelEdit}
            onSaveEdit={saveComment}
            onReply={reply}
            onDelete={commentId => deleteComment.mutate(commentId)}
        />
    )
}

/** What history needs to name lists, labels, people, cards, epics and sprints. */
function useActivityContext(data: CardFormValue) {
    const {
        projectLists,
        projectLabels,
        projectMembers,
        projectCards,
        projectEpics,
        projectSprints,
    } = data
    return useMemo(
        () => ({
            lists: projectLists,
            labels: projectLabels,
            members: projectMembers,
            cards: projectCards,
            epics: projectEpics,
            sprints: projectSprints,
        }),
        [projectLists, projectLabels, projectMembers, projectCards, projectEpics, projectSprints]
    )
}

/** Which comment is open for inline editing — at most one, local to the open card. */
function useCommentEdit() {
    const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
    // Where the press that opened the edit landed, so the caret lands there.
    // A ref: the editor reads it once as it mounts, and nothing displays it.
    const editStartPointRef = useRef<{ x: number; y: number } | undefined>(undefined)
    const startEdit = (commentId: string, at?: { x: number; y: number }) => {
        editStartPointRef.current = at
        setEditingCommentId(commentId)
    }
    // Close THIS comment, not whichever is open: a save can land after the
    // editor moved on to another comment, and closing that one would make the
    // new editor vanish as it opened.
    const closeEdit = (commentId: string) =>
        setEditingCommentId(current => (current === commentId ? null : current))
    return {
        editingCommentId,
        editStartPoint: editStartPointRef.current,
        startEdit,
        cancelEdit: () => setEditingCommentId(null),
        closeEdit,
    }
}
