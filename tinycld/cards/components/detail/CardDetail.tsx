import { type RefObject, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useCardDetail } from '../../hooks/useCardDetail'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { useCommentMutations } from '../../hooks/useCommentMutations'
import { useProjectRole } from '../../hooks/useProjectRole'
import { descriptionMode } from '../../lib/description-mode'
import type { BoardCardView, BoardLabel, BoardMember } from '../../types'
import { useBoardPresenceContext } from '../BoardPresenceProvider'
import { LabelManagerDialog } from '../LabelManagerDialog'
import { CommentComposer } from './CommentComposer'
import { DescriptionEditor } from './DescriptionEditor'
import { DetailActivity } from './DetailActivity'
import { DetailChecklist } from './DetailChecklist'
import { DetailProperties } from './DetailProperties'
import { EditableText, type EditableTextHandle } from './EditableText'
import { MarkdownText } from './MarkdownText'

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
    /**
     * Lets the container start a title edit for the `e` shortcut.
     *
     * The shortcut is registered by the CONTAINER, not here, because
     * `useRegisterShortcut` stamps the scope instance that is current when its
     * effect runs — and child effects run before parent ones, so registering in
     * this component would read the scope its container has not pushed yet.
     * Core's `withScopeId` states the rule: scope and registration belong in the
     * same component.
     */
    titleRef?: RefObject<EditableTextHandle | null>
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
    titleRef,
}: CardDetailProps) {
    const [isManagingLabels, setIsManagingLabels] = useState(false)
    const widthClass = variant === 'page' ? 'w-full max-w-[720px] self-center' : ''
    // Fetched here rather than threaded in as props, so the peek and the page
    // both get it without either container knowing about on-demand collections.
    const { checklist, comments } = useCardDetail(card.id)
    // Resolved here for the same reason — both containers share the gates.
    const { canEdit, canComment, isOwner } = useProjectRole(projectId)
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
                            ref={titleRef}
                            value={card.title}
                            onSave={title => updateCard.mutate({ cardId: card.id, title })}
                            placeholder="Card title"
                            accessibilityLabel="Edit card title"
                            textClassName="text-[20px] font-semibold leading-[27px] tracking-tight text-foreground"
                            isDisabled={!canEdit}
                        />
                    </View>
                    <DetailProperties
                        card={card}
                        projectLabels={projectLabels}
                        projectMembers={projectMembers}
                        onManageLabels={() => setIsManagingLabels(true)}
                        canEdit={canEdit}
                    />
                    <DescriptionSection
                        cardId={card.id}
                        description={card.description}
                        onSave={description => updateCard.mutate({ cardId: card.id, description })}
                        canEdit={canEdit}
                    />
                    <DetailChecklist
                        items={checklist}
                        cardId={card.id}
                        projectId={projectId}
                        canEdit={canEdit}
                    />
                    <DetailActivity
                        comments={comments}
                        canComment={canComment}
                        canModerate={isOwner}
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
            {/* Commentors keep the composer — that is what the role means. */}
            {canComment ? (
                <CommentComposer
                    widthClass={widthClass}
                    onSubmit={submitComment}
                    isPending={createComment.isPending}
                    replyingTo={replyingTo ?? undefined}
                    onCancelReply={() => setReplyingTo(null)}
                />
            ) : null}
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
 * The description, stored as Markdown (see types.ts) and now rendered as such.
 *
 * Editing stays plain-text: the source is what you edit, the rendering is what
 * you read. `EditableText` renders `renderValue` in place of its own <Text>
 * while idle and swaps back to a raw input the moment an edit starts, so the
 * markdown never has to round-trip through a rich-text model.
 */
function DescriptionSection({
    cardId,
    description,
    onSave,
    canEdit,
}: {
    cardId: string
    description?: string
    onSave: (value: string) => void
    canEdit: boolean
}) {
    const { doc, isReady, isConnected, canEditDoc, awareness, identity } = useBoardPresenceContext()

    // Chosen once, when this card's editor mounts, and deliberately not
    // re-evaluated: a description with two live write paths is how text gets
    // lost. A drop mid-sentence keeps the collaborative editor and shows a
    // reconnecting note — the words are in the local document and Yjs replays
    // them — rather than racing a mutation against the reconnect.
    const [mode] = useState(() => descriptionMode({ hasDoc: !!doc, isReady }))

    // A disabled editor still renders its placeholder styled as an affordance,
    // so a read-only card with no description drops the section entirely —
    // there is nothing to show and nothing to invite.
    if (!canEdit && !description && mode === 'mutation') return null

    return (
        <View className="mb-6">
            <Text className="text-[13px] font-semibold text-foreground mb-2.5">Description</Text>
            {mode === 'collab' && doc ? (
                <DescriptionEditor
                    // Rebinds to the right fragment when the peek switches cards.
                    key={cardId}
                    cardId={cardId}
                    doc={doc}
                    awareness={awareness}
                    identity={identity}
                    canEdit={canEdit && canEditDoc}
                    isConnected={isConnected}
                />
            ) : (
                <EditableText
                    value={description ?? ''}
                    onSave={onSave}
                    placeholder="Add a description — what does done look like?"
                    accessibilityLabel="Edit description"
                    multiline
                    isDisabled={!canEdit}
                    renderValue={value => <MarkdownText body={value} />}
                />
            )}
        </View>
    )
}

// ChecklistSection used to hide the whole section when empty. It is gone: the
// section now owns an "Add item" composer, and hiding it would mean a card with
// no checklist offers no way to start one.
