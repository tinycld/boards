import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import { notify } from '@tinycld/core/lib/notify'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { Menu } from '@tinycld/core/ui/menu'
import { Archive, ArrowRightLeft, Copy, MoreHorizontal, Trash2 } from 'lucide-react-native'
import { useState } from 'react'
import { useWritableProjects } from '../../hooks/useActiveBoard'
import { useArchiveCard, useDeleteCard, useDuplicateCard } from '../../hooks/useCardMutations'
import { rankForInsert } from '../../lib/move'
import { useCardsUIStore } from '../../stores/cards-ui-store'
import type { BoardCardView, BoardListView } from '../../types'
import { IconButton } from './IconButton'
import { MoveToBoardDialog } from './MoveToBoardDialog'

interface CardActionsMenuProps {
    card: BoardCardView
    /** The column the card sits in — the duplicate lands right after it. */
    list: BoardListView
    projectId: string
    /** Called after the card stops existing on the board, to close the view. */
    onDismiss: () => void
}

/**
 * The card's "More actions" menu — archive and delete.
 *
 * Both remove the card from the board, so both call `onDismiss`: leaving the
 * peek or the detail page open on a card that is no longer in the board tree
 * renders a not-found state the user did not ask for.
 *
 * Archive is not confirmed and delete is: archiving is reversible in principle
 * and destroys nothing, while deleting cascades to the card's checklist items,
 * comments and attachments server-side.
 */
export function CardActionsMenu({ card, list, projectId, onDismiss }: CardActionsMenuProps) {
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
    const [isMoving, setIsMoving] = useState(false)
    const mutedColor = useThemeColor('muted')
    const archiveCard = useArchiveCard()
    const deleteCard = useDeleteCard()
    const duplicateCard = useDuplicateCard(projectId)
    const openCard = useCardsUIStore(s => s.openCard)
    const cardId = card.id
    const cardTitle = card.title
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

    return (
        <>
            <Menu>
                <Menu.Trigger>
                    <IconButton label="More actions">
                        <MoreHorizontal size={15} color={mutedColor} strokeWidth={2.2} />
                    </IconButton>
                </Menu.Trigger>
                <Menu.Portal>
                    <Menu.Overlay />
                    <Menu.Content presentation="popover" placement="bottom" align="end">
                        <MenuActionItem label="Duplicate card" icon={Copy} onPress={duplicate} />
                        <MenuActionItem
                            label="Move to board…"
                            icon={ArrowRightLeft}
                            disabled={!hasOtherBoards}
                            onPress={() => setIsMoving(true)}
                        />
                        <MenuActionItem label="Archive card" icon={Archive} onPress={archive} />
                        <MenuActionItem
                            label="Delete card"
                            icon={Trash2}
                            onPress={() => setIsConfirmingDelete(true)}
                        />
                    </Menu.Content>
                </Menu.Portal>
            </Menu>

            <MoveToBoardDialog
                card={card}
                projectId={projectId}
                isOpen={isMoving}
                onClose={() => setIsMoving(false)}
                onMoved={({ boardName, key }) => {
                    notify.emit({
                        event: 'cards.card_moved',
                        title: `Moved to ${boardName}`,
                        body: key ? `Now ${key}` : undefined,
                        data: { board: boardName, key },
                    })
                    onDismiss()
                }}
            />

            <ConfirmDialog
                isOpen={isConfirmingDelete}
                onClose={() => setIsConfirmingDelete(false)}
                onConfirm={confirmDelete}
                title="Delete card?"
                // Sub-tasks are named explicitly BECAUSE they are the
                // exception: everything else in this sentence is destroyed,
                // and someone deleting a card with five sub-tasks needs to
                // know they survive rather than assuming the worst and
                // cancelling. `parent` is cascadeDelete: false for exactly
                // this reason.
                message={
                    card.subtaskTotal > 0
                        ? `"${cardTitle}" and its checklist, comments and attachments will be permanently deleted. Its ${card.subtaskTotal} sub-task${card.subtaskTotal === 1 ? '' : 's'} will stay on the board as top-level cards.`
                        : `"${cardTitle}" and its checklist, comments and attachments will be permanently deleted.`
                }
                confirmLabel="Delete"
                isDestructive
                isSubmitting={deleteCard.isPending}
            />
        </>
    )
}
