import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { Menu } from '@tinycld/core/ui/menu'
import {
    ArrowLeft,
    ArrowRight,
    FoldHorizontal,
    Gauge,
    MoreHorizontal,
    Pencil,
    Trash2,
} from 'lucide-react-native'
import { useState } from 'react'
import { Pressable } from 'react-native'
import { useDeleteList, useUpdateList } from '../hooks/useListMutations'
import { categoryLabel, LIST_CATEGORIES, type ListCategory } from '../lib/list-category'
import { rankForReorder } from '../lib/move'
import { useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardListRank, BoardListView } from '../types'
import { CategoryGlyph } from './CategoryGlyph'
import { WipLimitDialog } from './WipLimitDialog'

interface ColumnMenuProps {
    list: BoardListView
    /** Every column's rank, in render order — the reorder needs siblings. */
    listOrder: BoardListRank[]
    onRename: () => void
}

/**
 * The column header menu: rename, move, set the list's status, delete.
 *
 * Reorder lives here rather than behind a drag because the stepper/menu pair is
 * the accessible path — drag-and-drop is a later task and an addition, never the
 * only way to do something.
 */
export function ColumnMenu({ list, listOrder, onRename }: ColumnMenuProps) {
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
    const [isEditingLimit, setIsEditingLimit] = useState(false)
    const mutedColor = useThemeColor('muted')
    const updateList = useUpdateList()
    const deleteList = useDeleteList()
    // Only the setter — this menu renders only while the column is expanded,
    // so it never needs to read the flag it writes.
    const toggleCollapsed = useBoardsUIStore(s => s.toggleColumnCollapsed)

    const index = listOrder.findIndex(candidate => candidate.id === list.id)
    const canMoveLeft = index > 0
    const canMoveRight = index >= 0 && index < listOrder.length - 1

    const move = (delta: number) => {
        updateList.mutate({
            listId: list.id,
            position: rankForReorder(listOrder, list.id, index + delta),
        })
    }

    // The TOTAL, not `cards.length`: the cascade destroys every card in the
    // column, including the ones a filter is currently hiding. Naming the
    // filtered count would under-report exactly what this dialog exists to
    // warn about.
    const cardCount = list.totalCount

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
                            label="Collapse list"
                            icon={FoldHorizontal}
                            onPress={() => toggleCollapsed(list.id)}
                        />
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
                        <StatusSubmenu
                            selected={list.category}
                            onSelect={category => updateList.mutate({ listId: list.id, category })}
                        />
                        <MenuActionItem
                            label={limitLabel(list.wipLimit)}
                            icon={Gauge}
                            testID="boards-column-wip-limit"
                            onPress={() => setIsEditingLimit(true)}
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

            <WipLimitDialog
                list={list}
                isOpen={isEditingLimit}
                onClose={() => setIsEditingLimit(false)}
            />

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

/**
 * The list's status, as a submenu: one row per category, the current one
 * marked. A submenu rather than five top-level rows so the menu stays the
 * length it was, and a single nesting level, which is all core's Menu offers.
 */
function StatusSubmenu({
    selected,
    onSelect,
}: {
    selected: ListCategory
    onSelect: (category: ListCategory) => void
}) {
    return (
        <Menu.Sub>
            <Menu.SubTrigger>
                <Menu.ItemTitle>{`Status: ${categoryLabel(selected)}`}</Menu.ItemTitle>
            </Menu.SubTrigger>
            <Menu.SubContent>
                {LIST_CATEGORIES.map(category => (
                    <MenuActionItem
                        key={category}
                        label={categoryLabel(category)}
                        isActive={category === selected}
                        leading={<CategoryGlyph category={category} size={14} />}
                        testID={`boards-list-status-${category}`}
                        onPress={() => onSelect(category)}
                    />
                ))}
            </Menu.SubContent>
        </Menu.Sub>
    )
}

/** The menu row states the current limit, so the value is readable without opening the dialog. */
function limitLabel(limit: number | undefined): string {
    return limit === undefined ? 'Set WIP limit…' : `WIP limit: ${limit}`
}
