import { DropZone } from '@tinycld/core/components/DropZone'
import { useAuth } from '@tinycld/core/lib/auth'
import type { CollabDoc, FormHostUi } from '@tinycld/core/lib/forms/host-ui'
import { FormRenderer } from '@tinycld/core/ui/forms'
import { type RefObject, useCallback, useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { CardFormProvider, type CardFormValue } from '../../forms/CardFormContext'
import { useCardForm } from '../../forms/use-card-form'
import { useAttachmentMutations } from '../../hooks/useAttachmentMutations'
import { useProjectRole } from '../../hooks/useProjectRole'
import type { BoardCardView, BoardEpic, BoardLabel, BoardMember, BoardSprint } from '../../types'
import { LabelManagerDialog } from '../LabelManagerDialog'
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
 * component owns the frame below them (the drop zone, the scroll view, the
 * content width) and renders the card's form inside it: the card's type
 * decides which fields and sections show, and in what order.
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
    const formValue = useCardFormValue(props, role, openLabelManager)
    // Non-throwing: a card opened from the PUBLIC board has no session, and
    // the default useAuth() turns that screen into an error boundary.
    const { user } = useAuth({ throwIfAnon: false })
    // Only the drop path needs this here; the attachments section owns the
    // picker and the rows. Both write through the same upload store.
    const { uploadFiles } = useAttachmentMutations(card.id, projectId, user?.id ?? '')

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
                <ScrollView className="flex-1">
                    <CardFormProvider value={formValue}>
                        <View className={`px-6 pb-6 ${widthClass}`}>
                            <CardFormBody cardId={card.id} readOnly={!role.canEdit} />
                        </View>
                    </CardFormProvider>
                </ScrollView>
            </DropZone>
            <LabelManagerDialog
                isVisible={isManagingLabels}
                onClose={() => setIsManagingLabels(false)}
                projectId={projectId}
                labels={projectLabels}
            />
        </>
    )
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
    onManageLabels: () => void
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
        ]
    )
}

interface CardFormBodyProps {
    cardId: string
    /** Everyone who cannot edit the card; the comment sections gate on the role instead. */
    readOnly: boolean
}

/**
 * The card's form. Waits for the row, the type and the host's components:
 * rendered without the components, the card's own fields would show core's
 * placeholder for a kind it cannot render.
 */
function CardFormBody({ cardId, readOnly }: CardFormBodyProps) {
    const card = useCardForm(cardId)
    if (!card.isReady || !card.ui) return null
    return <CardFormView {...card} ui={card.ui} cardId={cardId} readOnly={readOnly} />
}

const noDoc = (): CollabDoc | null => null

type CardFormViewProps = CardFormBodyProps &
    Omit<ReturnType<typeof useCardForm>, 'ui'> & { ui: FormHostUi }

/**
 * Split out so `ui` is non-null for this component's whole life, which keeps
 * its `useDoc` call unconditional.
 */
function CardFormView({ cardId, readOnly, host, ui, edit, context }: CardFormViewProps) {
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
            testID="card-form"
        />
    )
}
