import { useFormsOfHost } from '@tinycld/core/lib/forms/use-forms-of-host'
import { notify } from '@tinycld/core/lib/notify'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useRecord } from '@tinycld/core/lib/use-record'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { Menu } from '@tinycld/core/ui/menu'
import { Archive, ArrowRightLeft, Copy, GitPullRequest, Shapes, Trash2 } from 'lucide-react-native'
import { useState } from 'react'
import { CARD_HOST_KEY } from '../../forms/hosts'
import { useWritableProjects } from '../../hooks/useActiveBoard'
import {
    useArchiveCard,
    useDeleteCard,
    useDuplicateCard,
    useUpdateCard,
} from '../../hooks/useCardMutations'
import { rankForInsert } from '../../lib/move'
import { useBoardsUIStore } from '../../stores/boards-ui-store'
import type { BoardCardView, BoardListView } from '../../types'
import { LinkPrDialog } from './LinkPrDialog'
import { MoveToBoardDialog } from './MoveToBoardDialog'

interface CardActionsInput {
    card: BoardCardView
    /** The column the card sits in — the duplicate lands right after it. */
    list: BoardListView
    projectId: string
    /** Called after the card stops existing on the board, to close the view. */
    onDismiss: () => void
}

/**
 * The card's "Card actions" menu — duplicate, move, change type, archive and
 * delete — split into the rows and the dialogs they open.
 *
 * The rows render inside a `Menu` (the header toolbar's More menu), and a
 * menu unmounts its rows the moment one is chosen. A dialog owned by a row
 * would therefore close as it opened, so the dialogs and the state that
 * opens them live in this hook and render beside the toolbar instead.
 *
 * Archive and delete both remove the card from the board, so both call
 * `onDismiss`: leaving the peek or the detail page open on a card that is no
 * longer in the board tree renders a not-found state the user did not ask for.
 *
 * Archive is not confirmed and delete is: archiving is reversible in principle
 * and destroys nothing, while deleting cascades to the card's checklist items,
 * comments and attachments server-side.
 */
export function useCardActions({ card, list, projectId, onDismiss }: CardActionsInput) {
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
    const [isMoving, setIsMoving] = useState(false)
    const [isLinkingPr, setIsLinkingPr] = useState(false)
    const archiveCard = useArchiveCard()
    const deleteCard = useDeleteCard()
    const duplicateCard = useDuplicateCard(projectId)
    const openCard = useBoardsUIStore(s => s.openCard)
    const cardId = card.id
    // No other board to move to → the item is offered disabled rather than
    // hidden, so the capability is discoverable.
    const hasOtherBoards = useWritableProjects().some(project => project.id !== projectId)
    const types = useCardTypes(cardId)

    const duplicate = () => {
        const index = list.cards.findIndex(c => c.id === cardId)
        duplicateCard.mutate(
            { card, position: rankForInsert(list.cards, index + 1) },
            { onSuccess: newId => openCard(newId) }
        )
    }

    const archive = () => {
        archiveCard.mutate({ cardId, archived: true })
        onDismiss()
    }

    const confirmDelete = () => {
        deleteCard.mutate(cardId, {
            onSuccess: () => {
                setIsConfirmingDelete(false)
                onDismiss()
            },
        })
    }

    return {
        card,
        projectId,
        onDismiss,
        hasOtherBoards,
        types,
        duplicate,
        archive,
        requestMove: () => setIsMoving(true),
        requestDelete: () => setIsConfirmingDelete(true),
        isMoving,
        closeMove: () => setIsMoving(false),
        isConfirmingDelete,
        closeDelete: () => setIsConfirmingDelete(false),
        confirmDelete,
        isDeleting: deleteCard.isPending,
        requestLinkPr: () => setIsLinkingPr(true),
        isLinkingPr,
        closeLinkPr: () => setIsLinkingPr(false),
    }
}

/**
 * The types a card can change to: the host's forms that are not archived,
 * with the card's own marked. A card on an archived type keeps it until
 * someone picks another; the archived one is no longer offered.
 */
function useCardTypes(cardId: string) {
    const { forms, defaultForm } = useFormsOfHost(CARD_HOST_KEY)
    const [cardsCollection] = useStore('boards_cards')
    const { record } = useRecord(cardsCollection, cardId)
    const updateCard = useUpdateCard()
    // An empty column is the server's window before it fills the default.
    const currentId = record?.form || defaultForm?.id
    const choices = forms
        .filter(form => !form.archived)
        .map(form => ({ id: form.id, name: form.name, isCurrent: form.id === currentId }))
    return {
        choices,
        // Nothing to change to: one type, and the card already has it.
        isOffered: choices.some(choice => !choice.isCurrent),
        change: (formId: string) => updateCard.mutate({ cardId, form: formId }),
    }
}

type CardActions = ReturnType<typeof useCardActions>

/** "Change type": a submenu of the card's types (a section in a sheet). */
function ChangeTypeRows({ types }: { types: CardActions['types'] }) {
    if (!types.isOffered) return null
    const rows = types.choices.map(choice => (
        <Menu.Item
            key={choice.id}
            label={choice.name}
            isSelected={choice.isCurrent}
            onSelect={() => types.change(choice.id)}
            testID={`card-change-type-${choice.id}`}
        />
    ))
    return (
        <Menu.Sub label="Change type" icon={Shapes} testID="card-change-type">
            {rows}
        </Menu.Sub>
    )
}

/** The menu rows. Must render inside a `Menu`. */
export function CardActionRows({ actions }: { actions: CardActions }) {
    return (
        <>
            <Menu.Item label="Duplicate card" icon={Copy} onSelect={actions.duplicate} />
            <Menu.Item
                label="Move to board…"
                icon={ArrowRightLeft}
                isDisabled={!actions.hasOtherBoards}
                onSelect={actions.requestMove}
            />
            <ChangeTypeRows types={actions.types} />
            <Menu.Item
                label="Link pull request…"
                icon={GitPullRequest}
                onSelect={actions.requestLinkPr}
            />
            <Menu.Item label="Archive card" icon={Archive} onSelect={actions.archive} />
            <Menu.Item
                label="Delete card"
                icon={Trash2}
                isDestructive
                onSelect={actions.requestDelete}
            />
        </>
    )
}

/** The dialogs the rows open. Render beside the toolbar, never inside the menu. */
export function CardActionDialogs({
    actions,
    isVisible,
}: {
    actions: CardActions
    isVisible: boolean
}) {
    const { card } = actions
    if (!isVisible) return null
    return (
        <>
            <MoveToBoardDialog
                card={card}
                projectId={actions.projectId}
                isOpen={actions.isMoving}
                onClose={actions.closeMove}
                onMoved={({ boardName, key }) => {
                    notify.emit({
                        event: 'boards.card_moved',
                        title: `Moved to ${boardName}`,
                        body: key ? `Now ${key}` : undefined,
                        data: { board: boardName, key },
                    })
                    actions.onDismiss()
                }}
            />

            <LinkPrDialog
                cardId={card.id}
                projectId={actions.projectId}
                isOpen={actions.isLinkingPr}
                onClose={actions.closeLinkPr}
            />

            <ConfirmDialog
                isOpen={actions.isConfirmingDelete}
                onClose={actions.closeDelete}
                onConfirm={actions.confirmDelete}
                title="Delete card?"
                // Sub-tasks are named explicitly BECAUSE they are the
                // exception: everything else in this sentence is destroyed,
                // and someone deleting a card with five sub-tasks needs to
                // know they survive rather than assuming the worst and
                // cancelling. `parent` is cascadeDelete: false for exactly
                // this reason.
                message={
                    card.subtaskTotal > 0
                        ? `"${card.title}" and its checklist, comments and attachments will be permanently deleted. Its ${card.subtaskTotal} sub-task${card.subtaskTotal === 1 ? '' : 's'} will stay on the board as top-level cards.`
                        : `"${card.title}" and its checklist, comments and attachments will be permanently deleted.`
                }
                confirmLabel="Delete"
                isDestructive
                isSubmitting={actions.isDeleting}
            />
        </>
    )
}
