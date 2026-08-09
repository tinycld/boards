import { type RefObject, useRef, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useCardDetail } from '../../hooks/useCardDetail'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { useCommentMutations } from '../../hooks/useCommentMutations'
import { useProjectRole } from '../../hooks/useProjectRole'
import { type DescriptionMode, descriptionMode } from '../../lib/description-mode'
import type { BoardCardView, BoardLabel, BoardMember } from '../../types'
import { useBoardPresenceContext } from '../BoardPresenceProvider'
import { LabelManagerDialog } from '../LabelManagerDialog'
import { CommentComposer } from './CommentComposer'
import {
    DESCRIPTION_HEADER_HEIGHT,
    type DescriptionEditorSlots,
    useDescriptionEditor,
} from './DescriptionEditor'
import { DetailActivity } from './DetailActivity'
import { DetailChecklist } from './DetailChecklist'
import { DetailProperties } from './DetailProperties'
import { EditableText, type EditableTextHandle } from './EditableText'
import { MarkdownText } from './MarkdownText'

type DetailVariant = 'peek' | 'page'

/**
 * Which ScrollView child the description header is, counting from zero:
 * title, properties, HEADER (label / toolbar), editor, checklist, activity.
 *
 * Keep in step with the JSX below. React Native pins by index, so a section
 * inserted above it silently pins the wrong thing rather than failing.
 */
const TOOLBAR_INDEX = 2

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

    const description = useDescriptionSection({
        cardId: card.id,
        description: card.description,
        onSave: value => updateCard.mutate({ cardId: card.id, description: value }),
        canEdit,
    })

    return (
        <>
            {/* Flat children, not one padded wrapper: `stickyHeaderIndices`
                only pins a DIRECT child of the ScrollView, so the toolbar has
                to sit at this level. The section padding therefore lives on
                each child. TOOLBAR_INDEX below must match the toolbar's
                position in this list. */}
            <ScrollView className="flex-1" stickyHeaderIndices={[TOOLBAR_INDEX]}>
                <View className={`px-6 mt-1 mb-[18px] ${widthClass}`}>
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
                <View className={`px-6 ${widthClass}`}>
                    <DetailProperties
                        card={card}
                        projectLabels={projectLabels}
                        projectMembers={projectMembers}
                        onManageLabels={() => setIsManagingLabels(true)}
                        canEdit={canEdit}
                    />
                </View>
                {/* Index TOOLBAR_INDEX — the sticky one. Always rendered, at a
                    FIXED height: the label and the toolbar take turns in this
                    one row, so focusing the editor swaps what is drawn without
                    changing what the row occupies. Reserving the space is also
                    what keeps sticky working — an out-of-flow overlay has no
                    box for either platform to pin. */}
                <View className={`px-6 ${widthClass}`}>
                    {description.body ? description.header : null}
                </View>
                <View className={`px-6 mb-6 overflow-visible ${widthClass}`}>
                    {description.body}
                </View>
                <View className={`px-6 ${widthClass}`}>
                    <DetailChecklist
                        items={checklist}
                        cardId={card.id}
                        projectId={projectId}
                        canEdit={canEdit}
                    />
                </View>
                <View className={`px-6 pb-6 ${widthClass}`}>
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
function useDescriptionSection({
    cardId,
    description,
    onSave,
    canEdit,
}: {
    cardId: string
    description?: string
    onSave: (value: string) => void
    canEdit: boolean
}): DescriptionEditorSlots {
    const { doc, isReady, isConnected, canEditDoc, awareness, identity } = useBoardPresenceContext()

    // Latched, not sampled: once collaborative it stays collaborative for this
    // mount (two live write paths is how text gets lost — see
    // descriptionMode), but it can still BECOME collaborative when the room
    // finishes syncing after this component mounted. That is the ordering on
    // the full-page card route, where the presence provider mounts with the
    // screen; sampling once there always lost the race and dropped the card to
    // the non-collaborative path without any visible sign.
    const modeRef = useRef<DescriptionMode>('mutation')
    modeRef.current = descriptionMode({ hasDoc: !!doc, isReady }, modeRef.current)
    const mode = modeRef.current

    const isCollab = mode === 'collab' && !!doc

    // Called unconditionally — hooks cannot sit behind the branch below. It
    // builds a plain local editor while `doc` is null, which costs nothing
    // because the collaborative branch is the only one that renders it.
    const editorSlots = useDescriptionEditor({
        cardId,
        doc: isCollab ? doc : null,
        awareness,
        identity,
        canEdit: canEdit && canEditDoc,
        isConnected,
    })

    if (isCollab) return editorSlots

    // A disabled editor still renders its placeholder styled as an affordance,
    // so a read-only card with no description drops the section entirely —
    // there is nothing to show and nothing to invite.
    const isHidden = !canEdit && !description

    return {
        // The plain-text fallback has no editor commands to drive a toolbar, so
        // this row only ever shows the label. Same fixed height as the
        // collaborative path, so the two modes do not lay out differently.
        header: (
            <View className="justify-center" style={{ height: DESCRIPTION_HEADER_HEIGHT }}>
                <Text className="text-[13px] font-semibold text-foreground">Description</Text>
            </View>
        ),
        body: isHidden ? null : (
            <EditableText
                value={description ?? ''}
                onSave={onSave}
                placeholder="Add a description — what does done look like?"
                accessibilityLabel="Edit description"
                multiline
                isDisabled={!canEdit}
                renderValue={value => <MarkdownText body={value} />}
            />
        ),
    }
}

// ChecklistSection used to hide the whole section when empty. It is gone: the
// section now owns an "Add item" composer, and hiding it would mean a card with
// no checklist offers no way to start one.
