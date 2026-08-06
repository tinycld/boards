import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { Menu } from '@tinycld/core/ui/menu'
import { Archive, MoreHorizontal, Trash2 } from 'lucide-react-native'
import { useState } from 'react'
import { useArchiveCard, useDeleteCard } from '../../hooks/useCardMutations'
import { IconButton } from './IconButton'

interface CardActionsMenuProps {
    cardId: string
    cardTitle: string
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
export function CardActionsMenu({ cardId, cardTitle, onDismiss }: CardActionsMenuProps) {
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
    const mutedColor = useThemeColor('muted')
    const archiveCard = useArchiveCard()
    const deleteCard = useDeleteCard()

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
                        <MenuActionItem label="Archive card" icon={Archive} onPress={archive} />
                        <MenuActionItem
                            label="Delete card"
                            icon={Trash2}
                            onPress={() => setIsConfirmingDelete(true)}
                        />
                    </Menu.Content>
                </Menu.Portal>
            </Menu>

            <ConfirmDialog
                isOpen={isConfirmingDelete}
                onClose={() => setIsConfirmingDelete(false)}
                onConfirm={confirmDelete}
                title="Delete card?"
                message={`"${cardTitle}" and its checklist, comments and attachments will be permanently deleted.`}
                confirmLabel="Delete"
                isDestructive
                isSubmitting={deleteCard.isPending}
            />
        </>
    )
}
