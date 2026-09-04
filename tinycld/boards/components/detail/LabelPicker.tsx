import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import { Menu } from '@tinycld/core/ui/menu'
import { Settings2 } from 'lucide-react-native'
import { Text, View } from 'react-native'
import type { BoardLabel } from '../../types'
import { menuPropsFor, type PickerAnchor } from './picker-anchor'

type LabelPickerProps = {
    /** Every label defined on this board. */
    labels: BoardLabel[]
    selectedIds: string[]
    onToggle: (labelId: string, isSelected: boolean) => void
    /** Opens the manager, where labels are created, renamed and deleted. */
    onManage: () => void
} & PickerAnchor

export function LabelPicker({
    labels,
    selectedIds,
    onToggle,
    onManage,
    ...anchor
}: LabelPickerProps) {
    const selected = new Set(selectedIds)

    return (
        <Menu {...menuPropsFor(anchor)}>
            {anchor.children ? <Menu.Trigger>{anchor.children}</Menu.Trigger> : null}
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="start">
                    {labels.length === 0 ? (
                        <View className="px-3 pt-2 pb-1 w-[220px]">
                            <Text className="text-[12.5px] text-muted">
                                No labels on this board yet.
                            </Text>
                        </View>
                    ) : (
                        labels.map(label => (
                            <MenuActionItem
                                key={label.id}
                                label={label.name}
                                colorDot={label.color}
                                isActive={selected.has(label.id)}
                                onPress={() => onToggle(label.id, selected.has(label.id))}
                            />
                        ))
                    )}
                    <MenuActionItem label="Manage labels…" icon={Settings2} onPress={onManage} />
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
