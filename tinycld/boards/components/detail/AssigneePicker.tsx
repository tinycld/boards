import { Menu } from '@tinycld/core/ui/menu'
import { Text } from 'react-native'
import type { BoardMember } from '../../types'
import { anchorPropsFor, type PickerAnchor } from './picker-anchor'

type AssigneePickerProps = {
    /**
     * The PROJECT's members, not the org roster: a card can only be assigned to
     * someone who can actually open the board.
     */
    members: BoardMember[]
    assignedIds: string[]
    onToggle: (memberId: string, isSelected: boolean) => void
} & PickerAnchor

/**
 * Multi-select, so the rows are checkbox items: a pick toggles and the menu
 * stays open for the next one, unlike the single-choice pickers.
 */
export function AssigneePicker({ members, assignedIds, onToggle, ...anchor }: AssigneePickerProps) {
    return (
        <Menu {...anchorPropsFor(anchor)} placement="bottom-start" title="Assignees">
            <AssigneePickerRows members={members} assignedIds={assignedIds} onToggle={onToggle} />
        </Menu>
    )
}

/** The rows alone, for a menu that hosts them itself — a toolbar's More submenu. */
export function AssigneePickerRows({
    members,
    assignedIds,
    onToggle,
}: Omit<AssigneePickerProps, keyof PickerAnchor>) {
    const assigned = new Set(assignedIds)
    return (
        <>
            <EmptyState isVisible={members.length === 0} />
            {members.map(member => (
                <Menu.CheckboxItem
                    key={member.id}
                    label={`${member.firstName} ${member.lastName}`.trim()}
                    isChecked={assigned.has(member.id)}
                    onToggle={() => onToggle(member.id, assigned.has(member.id))}
                />
            ))}
        </>
    )
}

/**
 * A guest reaching a board by share link reads no roster at all
 * (member-AND-non-guest by rule), so this empty state is expected, not broken.
 */
function EmptyState({ isVisible }: { isVisible: boolean }) {
    if (!isVisible) return null
    return (
        <Menu.Custom className="px-3 py-2 w-[220px]">
            <Text className="text-[12.5px] text-muted">No project members to assign.</Text>
        </Menu.Custom>
    )
}
