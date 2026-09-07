import { Menu } from '@tinycld/core/ui/menu'
import { Settings2 } from 'lucide-react-native'
import { Text } from 'react-native'
import type { BoardLabel } from '../../types'
import { anchorPropsFor, type PickerAnchor } from './picker-anchor'

type LabelPickerProps = {
    /** Every label defined on this board. */
    labels: BoardLabel[]
    selectedIds: string[]
    onToggle: (labelId: string, isSelected: boolean) => void
    /** Opens the manager, where labels are created, renamed and deleted. */
    onManage: () => void
} & PickerAnchor

/**
 * Multi-select, so the label rows are checkbox items that keep the menu open;
 * "Manage labels…" is a command and closes it.
 */
export function LabelPicker({
    labels,
    selectedIds,
    onToggle,
    onManage,
    ...anchor
}: LabelPickerProps) {
    return (
        <Menu {...anchorPropsFor(anchor)} placement="bottom-start" title="Labels">
            <LabelPickerRows
                labels={labels}
                selectedIds={selectedIds}
                onToggle={onToggle}
                onManage={onManage}
            />
        </Menu>
    )
}

/** The rows alone, for a menu that hosts them itself — a toolbar's More submenu. */
export function LabelPickerRows({
    labels,
    selectedIds,
    onToggle,
    onManage,
}: Omit<LabelPickerProps, keyof PickerAnchor>) {
    const selected = new Set(selectedIds)
    return (
        <>
            <EmptyState isVisible={labels.length === 0} />
            {labels.map(label => (
                <Menu.CheckboxItem
                    key={label.id}
                    label={label.name}
                    colorDot={label.color}
                    isChecked={selected.has(label.id)}
                    onToggle={() => onToggle(label.id, selected.has(label.id))}
                />
            ))}
            <Menu.Item label="Manage labels…" icon={Settings2} onSelect={onManage} />
        </>
    )
}

function EmptyState({ isVisible }: { isVisible: boolean }) {
    if (!isVisible) return null
    return (
        <Menu.Custom className="px-3 pt-2 pb-1 w-[220px]">
            <Text className="text-[12.5px] text-muted">No labels on this board yet.</Text>
        </Menu.Custom>
    )
}
