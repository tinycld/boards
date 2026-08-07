import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { Menu } from '@tinycld/core/ui/menu'
import {
    ArrowLeft,
    ArrowRight,
    CheckCircle2,
    MoreHorizontal,
    Pencil,
    Trash2,
} from 'lucide-react-native'
import { useState } from 'react'
import { Pressable } from 'react-native'
import { useDeleteList, useUpdateList } from '../hooks/useListMutations'
import { rankForReorder } from '../lib/move'
import type { BoardListView } from '../types'

interface ColumnMenuProps {
    list: BoardListView
    /** Every column on the board, in render order — the reorder needs siblings. */
    lists: BoardListView[]
    onRename: () => void
}

/**
 * The column header menu: rename, move, mark as the done column, delete.
 *
 * Reorder lives here rather than behind a drag because the stepper/menu pair is
 * the accessible path — drag-and-drop is a later task and an addition, never the
 * only way to do something.
 */
export function ColumnMenu({ list, lists, onRename }: ColumnMenuProps) {
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
    const mutedColor = useThemeColor('muted')
    const updateList = useUpdateList()
    const deleteList = useDeleteList()

    const index = lists.findIndex(candidate => candidate.id === list.id)
    const canMoveLeft = index > 0
    const canMoveRight = index >= 0 && index < lists.length - 1

    const move = (delta: number) => {
        updateList.mutate({
            listId: list.id,
            position: rankForReorder(lists, list.id, index + delta),
        })
    }

    const cardCount = list.cards.length

    return (
        <>
            <Menu>
                <Menu.Trigger>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${list.name} list actions`}
                        className="w-6 h-6 items-center justify-center rounded-md hover:bg-foreground/10 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
                    >
                        <MoreHorizontal size={15} color={mutedColor} strokeWidth={2} />
                    </Pressable>
                </Menu.Trigger>
                <Menu.Portal>
                    <Menu.Overlay />
                    <Menu.Content presentation="popover" placement="bottom" align="end">
                        <MenuActionItem label="Rename list" icon={Pencil} onPress={onRename} />
                        <MenuActionItem
                            label="Move left"
                            icon={ArrowLeft}
                            onPress={() => move(-1)}
                            disabled={!canMoveLeft}
                        />
                        <MenuActionItem
                            label="Move right"
                            icon={ArrowRight}
                            onPress={() => move(1)}
                            disabled={!canMoveRight}
                        />
                        <MenuActionItem
                            label={list.isDone ? 'Not the done list' : 'Mark as done list'}
                            icon={CheckCircle2}
                            isActive={list.isDone}
                            onPress={() =>
                                updateList.mutate({ listId: list.id, isDone: !list.isDone })
                            }
                        />
                        <MenuActionItem
                            label="Delete list"
                            icon={Trash2}
                            onPress={() => {
                                // An empty column destroys nothing, so it skips
                                // the confirm entirely rather than asking about
                                // zero cards.
                                if (cardCount === 0) deleteList.mutate(list.id)
                                else setIsConfirmingDelete(true)
                            }}
                        />
                    </Menu.Content>
                </Menu.Portal>
            </Menu>

            <ConfirmDialog
                isOpen={isConfirmingDelete}
                onClose={() => setIsConfirmingDelete(false)}
                onConfirm={() =>
                    deleteList.mutate(list.id, {
                        onSuccess: () => setIsConfirmingDelete(false),
                    })
                }
                title={`Delete "${list.name}"?`}
                // Naming the count is the whole point: the cascade is
                // server-side and invisible, so this dialog is the only place
                // the user learns the cards go too.
                message={`This also deletes ${cardCount} ${cardCount === 1 ? 'card' : 'cards'} in this list, with their checklists, comments and attachments. This can't be undone.`}
                confirmLabel="Delete list"
                isDestructive
                isSubmitting={deleteList.isPending}
            />
        </>
    )
}
