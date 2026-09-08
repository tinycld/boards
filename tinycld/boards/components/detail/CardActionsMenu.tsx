import { notify } from '@tinycld/core/lib/notify'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { Menu } from '@tinycld/core/ui/menu'
import { Archive, ArrowRightLeft, Copy, Trash2 } from 'lucide-react-native'
import { useState } from 'react'
import { useWritableProjects } from '../../hooks/useActiveBoard'
import { useArchiveCard, useDeleteCard, useDuplicateCard } from '../../hooks/useCardMutations'
import { rankForInsert } from '../../lib/move'
import { useBoardsUIStore } from '../../stores/boards-ui-store'
import type { BoardCardView, BoardListView } from '../../types'
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
 * The card's "Card actions" menu — duplicate, move, archive and delete — split
 * into the rows and the dialogs they open.
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
    const archiveCard = useArchiveCard()
    const deleteCard = useDeleteCard()
    const duplicateCard = useDuplicateCard(projectId)
    const openCard = useBoardsUIStore(s => s.openCard)
    const cardId = card.id
    // No other board to move to → the item is offered disabled rather than
    // hidden, so the capability is discoverable.
    const hasOtherBoards = useWritableProjects().some(project => project.id !== projectId)

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
    }
}

type CardActions = ReturnType<typeof useCardActions>

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
