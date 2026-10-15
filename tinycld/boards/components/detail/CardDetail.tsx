import { DropZone } from '@tinycld/core/components/DropZone'
import { useAuth } from '@tinycld/core/lib/auth'
import type { CollabDoc, FormHostUi } from '@tinycld/core/lib/forms/host-ui'
import { FormRenderer, type SectionsScroll } from '@tinycld/core/ui/forms'
import { type RefObject, useCallback, useMemo, useState } from 'react'
import { CardFormProvider, type CardFormValue } from '../../forms/CardFormContext'
import { useCardForm } from '../../forms/use-card-form'
import { useCollabDoc } from '../../forms/use-collab-doc'
import { roomFromCollab, useDescriptionSlots } from '../../forms/use-description-slots'
import { useFieldVisibility } from '../../forms/use-field-visibility'
import { useAttachmentMutations } from '../../hooks/useAttachmentMutations'
import { useCardDetail } from '../../hooks/useCardDetail'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { useCommentMutations } from '../../hooks/useCommentMutations'
import { useProjectRole } from '../../hooks/useProjectRole'
import { mentionMember } from '../../lib/mention-text'
import { useCommentReplyStore } from '../../stores/comment-reply-store'
import type { BoardCardView, BoardEpic, BoardLabel, BoardMember, BoardSprint } from '../../types'
import { useBoardPresenceContext } from '../BoardPresenceProvider'
import { LabelManagerDialog } from '../LabelManagerDialog'
import { CommentComposer } from './CommentComposer'
import type { DescriptionEditorSlots } from './DescriptionEditor'
import { filesToPicked } from './DetailAttachments'
import type { EditableTextHandle } from './EditableText'

type DetailVariant = 'peek' | 'modal' | 'page'

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
    projectEpics: BoardEpic[]
    projectSprints: BoardSprint[]
    sprintsEnabled: boolean
    projectMembers: BoardMember[]
    /** The board's lists, so history can name where a card moved. */
    projectLists: { id: string; name: string }[]
    /**
     * The board's cards — what the sub-task section lists and the parent
     * picker offers, and what lets history name a parent by its key.
     *
     * The whole board's cards rather than this card's children: choosing a
     * parent means choosing among the others, so a pre-filtered list could not
     * serve both. lib/subtasks.ts does the filtering.
     */
    projectCards: BoardCardView[]
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

/** How wide the content column runs on each surface — see `widthClass`. */
const WIDTH_CLASS: Record<DetailVariant, string> = {
    peek: '',
    modal: 'w-full max-w-[1100px] self-center',
    page: 'w-full max-w-[1200px] self-center',
}

/**
 * The card detail content, shared by the side peek, the modal and the
 * full-page screen.
 * The containers own their top bars (stepper, expand/close vs. back); this
 * component owns the frame below them (the drop zone, the content width, the
 * comment composer pinned below the scroll) and renders the card's form
 * inside it: the card's type decides which fields and sections show, and in
 * what order. The form owns the scroll view, so the description's toolbar can
 * be one of its rows and pin while the card scrolls.
 */
export function CardDetail(props: CardDetailProps) {
    const { card, variant, projectId, projectLabels } = props
    const [isManagingLabels, setIsManagingLabels] = useState(false)
    const openLabelManager = useCallback(() => setIsManagingLabels(true), [])
    // The peek is already as narrow as its panel, so it needs no cap; the
    // page and the modal are both wide surfaces whose text would otherwise run
    // the full width. The modal's own frame caps at 1400px, so its measure is
    // set a little narrower than the page's.
    const widthClass = WIDTH_CLASS[variant]
    // Resolved here so every surface shares the gates.
    const role = useProjectRole(projectId)
    const cardForm = useCardForm(card.id)
    const isFieldVisible = useFieldVisibility(cardForm.edit, cardForm.context)
    const description = useCardDescription(props, role.canEdit)
    const formValue = useCardFormValue(props, role, openLabelManager, isFieldVisible, description)
    // Non-throwing: a card opened from the PUBLIC board has no session, and
    // the default useAuth() turns that screen into an error boundary.
    const { user } = useAuth({ throwIfAnon: false })
    // Only the drop path needs this here; the attachments section owns the
    // picker and the rows. Both write through the same upload store.
    const { uploadFiles } = useAttachmentMutations(card.id, projectId, user?.id ?? '')
    const scroll: SectionsScroll = { rowClassName: `px-6 ${widthClass}` }

    return (
        <>
            {/* Dropping a file anywhere on the card attaches it. Web-only in
                effect — DropZone renders a plain View on native, where there
                is no drag source to begin with. */}
            <DropZone
                isEnabled={role.canEdit}
                onDrop={files => uploadFiles(filesToPicked(files))}
                label="Drop to attach"
            >
                <CardFormProvider value={formValue}>
                    <CardFormBody
                        cardForm={cardForm}
                        cardId={card.id}
                        readOnly={!role.canEdit}
                        scroll={scroll}
                    />
                </CardFormProvider>
            </DropZone>
            <CardCommentComposer
                isVisible={role.canComment && isFieldVisible('activity')}
                cardId={card.id}
                projectId={projectId}
                widthClass={widthClass}
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

interface CardCommentComposerProps {
    isVisible: boolean
    cardId: string
    projectId: string
    widthClass: string
}

/**
 * The comment composer: frame chrome, pinned below the scroll so it is always
 * at hand, rather than a field of the card's form. Commentors keep it — that
 * is what the role means — unless the card's type hides the activity section,
 * where the comments it writes would show. A reply started in the activity
 * list reaches it through the reply store.
 */
function CardCommentComposer({ isVisible, ...props }: CardCommentComposerProps) {
    if (!isVisible) return null
    return <CommentComposerBody {...props} />
}

function CommentComposerBody({
    cardId,
    projectId,
    widthClass,
}: Omit<CardCommentComposerProps, 'isVisible'>) {
    const { attachments } = useCardDetail(cardId)
    const { createComment } = useCommentMutations(cardId, projectId)
    const replyTarget = useCommentReplyStore(s => s.replyingTo)
    const cancelReply = useCommentReplyStore(s => s.cancelReply)
    const replyingTo = replyTarget?.cardId === cardId ? replyTarget : undefined
    const submit = (body: string) =>
        createComment.mutate({ body, parent: replyingTo?.id ?? '' }, { onSuccess: cancelReply })
    return (
        <CommentComposer
            widthClass={widthClass}
            cardId={cardId}
            projectId={projectId}
            attachments={attachments}
            onSubmit={submit}
            isPending={createComment.isPending}
            replyingTo={replyingTo}
            onCancelReply={cancelReply}
        />
    )
}

/**
 * The description's editor, once per card. Lifted here from the description
 * field because the form draws its header and its body in separate rows, the
 * header pinned (DescriptionHeader), and one editor has to drive both.
 */
function useCardDescription(props: CardDetailProps, canEdit: boolean): DescriptionEditorSlots {
    const { card, projectId, projectMembers } = props
    const { isConnected } = useBoardPresenceContext()
    const collab = useCollabDoc()
    const { attachments } = useCardDetail(card.id)
    const updateCard = useUpdateCard()
    const mentionMembers = useMemo(() => projectMembers.map(mentionMember), [projectMembers])
    return useDescriptionSlots({
        cardId: card.id,
        projectId,
        attachments,
        mentionMembers,
        description: card.description,
        onSave: value => updateCard.mutate({ cardId: card.id, description: value }),
        canEdit,
        room: roomFromCollab(collab, isConnected),
    })
}

type CardRole = Pick<CardFormValue, 'canEdit' | 'canComment' | 'isOwner'>

/**
 * What the card's host components render from. Memoized on its parts: every
 * field and section reads this context, so a new object each render would
 * re-render all of them.
 */
function useCardFormValue(
    props: CardDetailProps,
    role: CardRole,
    onManageLabels: () => void,
    isFieldVisible: (key: string) => boolean,
    description: DescriptionEditorSlots
): CardFormValue {
    const {
        card,
        projectId,
        projectLabels,
        projectEpics,
        projectSprints,
        sprintsEnabled,
        projectMembers,
        projectLists,
        projectCards,
        titleRef,
    } = props
    const { canEdit, canComment, isOwner } = role
    return useMemo(
        () => ({
            card,
            projectId,
            projectLabels,
            projectEpics,
            projectSprints,
            sprintsEnabled,
            projectMembers,
            projectLists,
            projectCards,
            canEdit,
            canComment,
            isOwner,
            titleRef,
            onManageLabels,
            isFieldVisible,
            description,
        }),
        [
            card,
            projectId,
            projectLabels,
            projectEpics,
            projectSprints,
            sprintsEnabled,
            projectMembers,
            projectLists,
            projectCards,
            canEdit,
            canComment,
            isOwner,
            titleRef,
            onManageLabels,
            isFieldVisible,
            description,
        ]
    )
}

type CardForm = ReturnType<typeof useCardForm>

interface CardFormBodyProps {
    /** Lifted to CardDetail: the composer outside the form reads its rules too. */
    cardForm: CardForm
    cardId: string
    /** Everyone who cannot edit the card; the comment sections gate on the role instead. */
    readOnly: boolean
    /** The content column each of the form's rows takes; the form owns the scroll view. */
    scroll: SectionsScroll
}

/**
 * The card's form. Waits for the row, the type and the host's components:
 * rendered without the components, the card's own fields would show core's
 * placeholder for a kind it cannot render.
 */
function CardFormBody({ cardForm, ...props }: CardFormBodyProps) {
    if (!cardForm.isReady || !cardForm.ui) return null
    return <CardFormView {...cardForm} {...props} ui={cardForm.ui} />
}

const noDoc = (): CollabDoc | null => null

type CardFormViewProps = Omit<CardFormBodyProps, 'cardForm'> &
    Omit<CardForm, 'ui'> & { ui: FormHostUi }

/**
 * Split out so `ui` is non-null for this component's whole life, which keeps
 * its `useDoc` call unconditional.
 */
function CardFormView({ cardId, readOnly, scroll, host, ui, edit, context }: CardFormViewProps) {
    const useDoc = ui.useDoc ?? noDoc
    const collab = useDoc(cardId)
    if (!edit.definition) return null
    return (
        <FormRenderer
            host={host}
            ui={ui}
            definition={edit.definition}
            layout="sections"
            form={edit.form}
            context={context}
            recordId={cardId}
            readOnly={readOnly}
            collab={collab}
            schemaRef={edit.schemaRef}
            scroll={scroll}
            testID="card-form"
        />
    )
}
