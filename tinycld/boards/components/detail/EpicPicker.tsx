import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import { Menu } from '@tinycld/core/ui/menu'
import { CircleSlash } from 'lucide-react-native'
import type { ReactElement } from 'react'
import { Text, View } from 'react-native'
import type { BoardEpic } from '../../types'

interface EpicPickerProps {
    /** Every epic on this board, in rank order. */
    epics: BoardEpic[]
    /** The card's epic id, or '' when it is unfiled. */
    selectedId: string
    onSelect: (epicId: string) => void
    children: ReactElement
}

/**
 * Pick the ONE epic a card is filed under — single-select, unlike LabelPicker.
 * A card belongs to one plan; `boards_cards.epic` is maxSelect 1.
 *
 * Archived epics are hidden UNLESS the card is filed under one: an archived
 * epic is closed to new work, but a card already in it must still show where it
 * sits, and re-picking the same value must not silently move it.
 *
 * No "Manage epics…" item, and the asymmetry with LabelPicker is deliberate:
 * a label is created from the card that needs it, while an epic is a plan set
 * up for the BOARD before cards are filed into it — so it is managed from the
 * board menu (BoardMenu → "Epics…"), beside the board's other settings.
 */
export function EpicPicker({ epics, selectedId, onSelect, children }: EpicPickerProps) {
    const offered = epics.filter(epic => !epic.archived || epic.id === selectedId)

    return (
        <Menu>
            <Menu.Trigger>{children}</Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="start">
                    {offered.length === 0 ? (
                        <View className="px-3 pt-2 pb-1 w-[220px]">
                            <Text className="text-[12.5px] text-muted">
                                No epics on this board yet.
                            </Text>
                        </View>
                    ) : (
                        offered.map(epic => (
                            <MenuActionItem
                                key={epic.id}
                                label={epic.title}
                                colorDot={epic.color}
                                isActive={epic.id === selectedId}
                                onPress={() => onSelect(epic.id)}
                            />
                        ))
                    )}
                    <ClearEpicItem isVisible={selectedId !== ''} onSelect={onSelect} />
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}

/**
 * The "No epic" row, offered only when there is something to clear: an unfiled
 * card has nothing to remove, and the item would read as a bug.
 *
 * Its own component rather than `{selectedId && <MenuActionItem …>}` inline —
 * the conditional-visibility convention in CLAUDE.md. Core's MenuActionItem
 * takes no `isVisible` of its own, so the gate lives in this wrapper rather
 * than being added to a shared component for one caller's sake.
 */
function ClearEpicItem({
    isVisible,
    onSelect,
}: {
    isVisible: boolean
    onSelect: (epicId: string) => void
}) {
    if (!isVisible) return null
    return <MenuActionItem label="No epic" icon={CircleSlash} onPress={() => onSelect('')} />
}
