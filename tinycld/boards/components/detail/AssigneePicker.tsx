import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { Menu } from '@tinycld/core/ui/menu'
import { Text, View } from 'react-native'
import type { BoardMember } from '../../types'
import { menuPropsFor, type PickerAnchor } from './picker-anchor'

type AssigneePickerProps = {
    /**
     * The PROJECT's members, not the org roster: a card can only be assigned to
     * someone who can actually open the board.
     */
    members: BoardMember[]
    assignedIds: string[]
    onToggle: (memberId: string, isSelected: boolean) => void
} & PickerAnchor

export function AssigneePicker({ members, assignedIds, onToggle, ...anchor }: AssigneePickerProps) {
    const assigned = new Set(assignedIds)

    return (
        <Menu {...menuPropsFor(anchor)}>
            {anchor.children ? <Menu.Trigger>{anchor.children}</Menu.Trigger> : null}
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="start">
                    {members.length === 0 ? (
                        // A guest reaching a board by share link reads no
                        // roster at all (member-AND-non-guest by rule), so this
                        // empty state is expected, not broken.
                        <View className="px-3 py-2 w-[220px]">
                            <Text className="text-[12.5px] text-muted">
                                No project members to assign.
                            </Text>
                        </View>
                    ) : (
                        members.map(member => (
                            <MenuActionItem
                                key={member.id}
                                label={`${member.firstName} ${member.lastName}`.trim()}
                                isActive={assigned.has(member.id)}
                                leading={
                                    <NameAvatar
                                        firstName={member.firstName}
                                        lastName={member.lastName}
                                        size={18}
                                        colorKey={member.id}
                                    />
                                }
                                onPress={() => onToggle(member.id, assigned.has(member.id))}
                            />
                        ))
                    )}
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
