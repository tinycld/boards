import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useCardDetail } from '../../hooks/useCardDetail'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { useCommentMutations } from '../../hooks/useCommentMutations'
import type { BoardCardView, BoardLabel, BoardMember } from '../../types'
import { LabelManagerDialog } from '../LabelManagerDialog'
import { CommentComposer } from './CommentComposer'
import { DetailActivity } from './DetailActivity'
import { DetailChecklist } from './DetailChecklist'
import { DetailProperties } from './DetailProperties'
import { EditableText } from './EditableText'

type DetailVariant = 'peek' | 'page'

interface CardDetailProps {
    card: BoardCardView
    variant: DetailVariant
    /**
     * The board the card belongs to. Threaded in rather than read off the card:
     * every child collection's access rule resolves membership through its own
     * denormalized `project` relation, so inserts need it, and BoardCardView
     * deliberately does not carry it (the card is always rendered inside a
     * board that already knows).
     */
    projectId: string
    /** The board's labels and roster — what the pickers offer. */
    projectLabels: BoardLabel[]
    projectMembers: BoardMember[]
}

/**
 * The card detail content, shared by the side peek and the full-page screen.
 * The containers own their top bars (stepper, expand/close vs. back); this
 * component owns everything below: title, properties, description, checklist,
 * activity, and the comment composer.
 */
export function CardDetail({
    card,
    variant,
    projectId,
    projectLabels,
    projectMembers,
}: CardDetailProps) {
    const [isManagingLabels, setIsManagingLabels] = useState(false)
    const widthClass = variant === 'page' ? 'w-full max-w-[720px] self-center' : ''
    // Fetched here rather than threaded in as props, so the peek and the page
    // both get it without either container knowing about on-demand collections.
    const { checklist, comments } = useCardDetail(card.id)
    const updateCard = useUpdateCard()
    const { createComment, deleteComment } = useCommentMutations(card.id, projectId)
    // Which comment the composer is replying to. Local because it is transient
    // UI state that dies with the open card, and it lives HERE rather than in
    // the composer because the activity list is what sets it.
    const [replyingTo, setReplyingTo] = useState<{ id: string; authorName: string } | null>(null)

    const submitComment = (body: string) => {
        createComment.mutate(
            { body, parent: replyingTo?.id ?? '' },
            { onSuccess: () => setReplyingTo(null) }
        )
    }

    return (
        <>
            <ScrollView className="flex-1">
                <View className={`px-6 pb-6 ${widthClass}`}>
                    <View className="mt-1 mb-[18px]">
                        <EditableText
                            value={card.title}
                            onSave={title => updateCard.mutate({ cardId: card.id, title })}
                            placeholder="Card title"
                            accessibilityLabel="Edit card title"
                            textClassName="text-[20px] font-semibold leading-[27px] tracking-tight text-foreground"
                        />
                    </View>
                    <DetailProperties
                        card={card}
                        projectLabels={projectLabels}
                        projectMembers={projectMembers}
                        onManageLabels={() => setIsManagingLabels(true)}
                    />
                    <DescriptionSection
                        description={card.description}
                        onSave={description => updateCard.mutate({ cardId: card.id, description })}
                    />
                    <DetailChecklist items={checklist} cardId={card.id} projectId={projectId} />
                    <DetailActivity
                        comments={comments}
                        onReply={comment =>
                            setReplyingTo({
                                id: comment.id,
                                authorName: comment.author.firstName || 'this comment',
                            })
                        }
                        onDelete={commentId => deleteComment.mutate(commentId)}
                    />
                </View>
            </ScrollView>
            <CommentComposer
                widthClass={widthClass}
                onSubmit={submitComment}
                isPending={createComment.isPending}
                replyingTo={replyingTo ?? undefined}
                onCancelReply={() => setReplyingTo(null)}
            />
            <LabelManagerDialog
                isVisible={isManagingLabels}
                onClose={() => setIsManagingLabels(false)}
                projectId={projectId}
                labels={projectLabels}
            />
        </>
    )
}

/**
 * The description is stored as Markdown (see types.ts) but rendered as plain
 * text for now — editing it and rendering it are separate concerns, and a
 * half-wired renderer is worse than none. Rendering is filed in M7.
 */
function DescriptionSection({
    description,
    onSave,
}: {
    description?: string
    onSave: (value: string) => void
}) {
    return (
        <View className="mb-6">
            <Text className="text-[13px] font-semibold text-foreground mb-2.5">Description</Text>
            <EditableText
                value={description ?? ''}
                onSave={onSave}
                placeholder="Add a description — what does done look like?"
                accessibilityLabel="Edit description"
                multiline
            />
        </View>
    )
}

// ChecklistSection used to hide the whole section when empty. It is gone: the
// section now owns an "Add item" composer, and hiding it would mean a card with
// no checklist offers no way to start one.
