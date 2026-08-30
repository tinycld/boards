import { DropZone } from '@tinycld/core/components/DropZone'
import { MARKDOWN_TRAILING_SPACE } from '@tinycld/core/components/help/MarkdownRenderer'
import { useAuth } from '@tinycld/core/lib/auth'
import { type RefObject, useRef, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useAttachmentMutations } from '../../hooks/useAttachmentMutations'
import { useCardDetail } from '../../hooks/useCardDetail'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { useCommentMutations } from '../../hooks/useCommentMutations'
import { useProjectRole } from '../../hooks/useProjectRole'
import { type DescriptionMode, descriptionMode } from '../../lib/description-mode'
import type { BoardAttachment, BoardCardView, BoardLabel, BoardMember } from '../../types'
import { useBoardPresenceContext } from '../BoardPresenceProvider'
import { LabelManagerDialog } from '../LabelManagerDialog'
import { CommentComposer } from './CommentComposer'
import {
    DESCRIPTION_BODY_PADDING,
    DESCRIPTION_HEADER_HEIGHT,
    DESCRIPTION_MIN_BODY_HEIGHT,
    type DescriptionEditorSlots,
    useDescriptionEditor,
} from './DescriptionEditor'
import { DetailActivity } from './DetailActivity'
import { DetailAttachments, filesToPicked } from './DetailAttachments'
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
    const widthClass = variant === 'page' ? 'w-full max-w-[1200px] self-center' : ''
    // Fetched here rather than threaded in as props, so the peek and the page
    // both get it without either container knowing about on-demand collections.
    const { checklist, comments, attachments, isReady } = useCardDetail(card.id)
    // Resolved here for the same reason — both containers share the gates.
    const { canEdit, canComment, isOwner } = useProjectRole(projectId)
    // The card's CHILDREN are not editable until the detail query has SETTLED,
    // and this is a correctness gate rather than a cosmetic one: before it
    // settles, an empty result is indistinguishable from a card that genuinely
    // has no checklist, comments or attachments, so a live composer invites the
    // user to re-add items they already have and end up with duplicates.
    //
    // Scoped to the children DELIBERATELY. The title, description and labels
    // live on the card record itself, which both containers already resolved
    // before mounting this component — they have nothing to wait for, and
    // gating them on the children's query made the description render blank and
    // uneditable for the life of that fetch.
    const canEditChildren = canEdit && isReady
    const canCommentNow = canComment && isReady
    const updateCard = useUpdateCard()
    // Only the drop path needs this here — the strip owns the picker and the
    // rows. Both write through the same store, so the two callers of
    // useAttachmentMutations cannot disagree about what is in flight.
    // Non-throwing: a card opened from the PUBLIC board has no session, and
    // the default useAuth() turns that screen into an error boundary. Every
    // read below already tolerates a null user.
    const { user } = useAuth({ throwIfAnon: false })
    const { uploadFiles } = useAttachmentMutations(card.id, projectId, user?.id ?? '')
    const { createComment, updateComment, deleteComment } = useCommentMutations(card.id, projectId)
    // Which comment the composer is replying to. Local because it is transient
    // UI state that dies with the open card, and it lives HERE rather than in
    // the composer because the activity list is what sets it.
    const [replyingTo, setReplyingTo] = useState<{ id: string; authorName: string } | null>(null)
    // Which comment is open for inline editing — at most one; starting a new
    // edit closes the previous one.
    const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
    // Where the press that opened the current inline edit landed, handed to the
    // editor so the caret lands there rather than at the end of the comment.
    //
    // A ref, not state: it is read once by the editor as it mounts and would
    // otherwise re-render the whole card panel for a value nothing displays.
    const editStartPointRef = useRef<{ x: number; y: number } | undefined>(undefined)
    const startEditingComment = (commentId: string, at?: { x: number; y: number }) => {
        editStartPointRef.current = at
        setEditingCommentId(commentId)
    }

    const submitComment = (body: string) => {
        createComment.mutate(
            { body, parent: replyingTo?.id ?? '' },
            { onSuccess: () => setReplyingTo(null) }
        )
    }

    const saveComment = (commentId: string, body: string) => {
        // Close immediately — the pbtsdb update is optimistic, so the new
        // body renders at once; failures surface through the mutation.
        updateComment.mutate({ commentId, body })
        // Close THIS comment, not whichever one happens to be open.
        //
        // A save can land after the editor has moved on: clicking a second
        // comment hands the editor over and the first commits on its way out,
        // and that commit reads its content asynchronously. A bare
        // `setEditingCommentId(null)` then closes the comment the user just
        // clicked into — the edit saved correctly, but the new editor vanished
        // as it opened.
        setEditingCommentId(current => (current === commentId ? null : current))
    }

    const description = useDescriptionSection({
        cardId: card.id,
        projectId,
        attachments,
        description: card.description,
        onSave: value => updateCard.mutate({ cardId: card.id, description: value }),
        canEdit,
    })

    return (
        <>
            {/* Dropping a file anywhere on the card attaches it. Web-only in
                effect — DropZone renders a plain View on native, where there
                is no drag source to begin with. */}
            <DropZone
                isEnabled={canEdit}
                onDrop={files => uploadFiles(filesToPicked(files))}
                label="Drop to attach"
            >
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
                        <DetailAttachments
                            attachments={attachments}
                            cardId={card.id}
                            projectId={projectId}
                            canEdit={canEditChildren}
                            isOwner={isOwner}
                        />
                    </View>
                    <View className={`px-6 ${widthClass}`}>
                        <DetailChecklist
                            items={checklist}
                            cardId={card.id}
                            projectId={projectId}
                            canEdit={canEditChildren}
                        />
                    </View>
                    <View className={`px-6 pb-6 ${widthClass}`}>
                        <DetailActivity
                            comments={comments}
                            canComment={canCommentNow}
                            canModerate={isOwner}
                            cardId={card.id}
                            projectId={projectId}
                            attachments={attachments}
                            editingCommentId={editingCommentId}
                            isSaving={updateComment.isPending}
                            onStartEdit={startEditingComment}
                            editStartPoint={editStartPointRef.current}
                            onCancelEdit={() => setEditingCommentId(null)}
                            onSaveEdit={saveComment}
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
            </DropZone>
            {/* Commentors keep the composer — that is what the role means. */}
            {canComment ? (
                <CommentComposer
                    widthClass={widthClass}
                    cardId={card.id}
                    projectId={projectId}
                    attachments={attachments}
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
    projectId,
    attachments,
    description,
    onSave,
    canEdit,
}: {
    cardId: string
    projectId: string
    attachments: BoardAttachment[]
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

    // The collaborative editor is a WebView, and a WebView is the single most
    // expensive thing on a card. Mounting one to DISPLAY a description made
    // merely opening a card pay for an editor most opens never use, so LazyEditor
    // defers it until someone actually starts editing.
    //
    // What this costs, stated plainly: the read state is a snapshot rather than
    // a live document. It still updates — `description` comes from the card
    // record through useLiveQuery, so another person's edits appear when the
    // server flushes them — but it does not stream keystroke by keystroke, and
    // remote carets exist only while the editor is mounted. Presence is
    // unaffected: who has the card open is published by useBoardPresence at the
    // BOARD level and never depended on this editor.
    //
    // Called unconditionally — hooks cannot sit behind the branch below. It
    // builds a plain local editor while `doc` is null, which costs nothing
    // because the collaborative branch is the only one that renders it.
    const editorSlots = useDescriptionEditor({
        cardId,
        projectId,
        attachments,
        doc: isCollab ? doc : null,
        awareness,
        identity,
        // Tapping needs a writable doc, which merely reading does not: someone
        // can read while the room settles.
        canEdit: canEdit && canEditDoc,
        isConnected,
        description,
        // ALWAYS rendered, never conditionally null.
        //
        // The caller draws the section's header as `body ? header : null`, so a
        // null here deletes the whole Description row. The collaborative path
        // never hid it — even a Commentor got a read-only editor and so still
        // saw the label — and hiding it for an empty description silently
        // removed the row for anyone without edit rights. (The plain-text
        // fallback below DOES hide an empty read-only description; that rule
        // belongs to it, because its affordance would otherwise be a dead
        // input.)
        readView: (
            <DescriptionReadView
                description={description}
                projectId={projectId}
                canEdit={canEdit && canEditDoc}
            />
        ),
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
                renderValue={value => <MarkdownText body={value} projectId={projectId} />}
            />
        ),
    }
}

/**
 * A collaborative description while nobody is editing it.
 *
 * Deliberately cheap: markdown text and a press target, no WebView. That is the
 * whole point of the swap — a card is read far more often than it is edited,
 * and an editor per card-open is the most expensive thing on the screen.
 *
 * The prose is rendered at the editor's own scale (`purpose="description"`,
 * pinned by markdown-purpose.test.ts), so tapping into an edit does not reflow
 * the text under the reader's finger.
 */
function DescriptionReadView({
    description,
    projectId,
    canEdit,
}: {
    description?: string
    projectId: string
    canEdit: boolean
}) {
    // The press target belongs to LazyEditor, which wraps this. What stays here
    // is the testID e2e locates and the empty-state affordance.
    //
    // NEVER returns null. The caller renders the section's header as
    // `body ? header : null`, so a null here silently deletes the whole
    // Description row — which is what happened to a Commentor opening a card
    // that had no description yet. Whether the section appears at all is the
    // caller's decision; this only decides what fills it.
    if (!canEdit) {
        return (
            <View testID="cards-description-read" className="py-2">
                {description ? <MarkdownText body={description} projectId={projectId} /> : null}
            </View>
        )
    }
    return (
        // No testID: LazyEditor's press target wraps this and carries it, and
        // two elements sharing one testID is a strict-mode violation in e2e.
        <View
            // The empty state is an affordance rather than prose: without a
            // filled box there is nothing to tell someone the blank space is
            // where a description goes.
            className={
                description
                    ? 'py-2 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring rounded-lg'
                    : 'bg-foreground/5 rounded-lg px-3.5 py-3'
            }
            // The SAME floor the editor applies, so a short description does not
            // grow the section when it is tapped — see the constant's note.
            //
            // The editor's floor sits on the editing SURFACE, inside that
            // component's own vertical padding, so the equivalent here has to
            // clear this box's padding too or the two reserve different spans.
            // Only while there is prose: the empty state is its own filled box
            // and sizes itself.
            style={
                description
                    ? {
                          minHeight:
                              DESCRIPTION_MIN_BODY_HEIGHT +
                              DESCRIPTION_BODY_PADDING * 2 +
                              MARKDOWN_TRAILING_SPACE,
                      }
                    : undefined
            }
        >
            {description ? (
                <MarkdownText body={description} projectId={projectId} />
            ) : (
                <Text className="text-[13.5px] text-muted">
                    Add a description — what does done look like?
                </Text>
            )}
        </View>
    )
}

// ChecklistSection used to hide the whole section when empty. It is gone: the
// section now owns an "Add item" composer, and hiding it would mean a card with
// no checklist offers no way to start one.
