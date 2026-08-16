import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { Menu } from '@tinycld/core/ui/menu'
import { UserMinus } from 'lucide-react-native'
import type { ReactElement } from 'react'
import { Text, View } from 'react-native'
import type { BoardMember } from '../../types'

interface ReporterPickerProps {
    /**
     * The PROJECT's members, not the org roster — the same constraint the
     * assignee picker has: a card's reporter must be someone who can open the
     * board to answer about it.
     */
    members: BoardMember[]
    /** The reporter's users id, or undefined when the card has none. */
    selectedId: string | undefined
    /** '' clears the field; see UpdateCardInput. */
    onSelect: (memberId: string) => void
    children: ReactElement
}

/**
 * Single-select sibling of AssigneePicker.
 *
 * The two differ only in arity, which is the schema's doing: `reporter` is
 * maxSelect:1, so this sets a value rather than toggling membership of an
 * array, and at most one row is ever active.
 */
export function ReporterPicker({ members, selectedId, onSelect, children }: ReporterPickerProps) {
    return (
        <Menu>
            <Menu.Trigger>{children}</Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="start">
                    {members.length === 0 ? (
                        // A guest reaching a board by share link reads no roster
                        // at all (member-AND-non-guest by rule), so this empty
                        // state is expected, not broken.
                        <View className="px-3 py-2 w-[220px]">
                            <Text className="text-[12.5px] text-muted">
                                No project members to report to.
                            </Text>
                        </View>
                    ) : (
                        members.map(member => (
                            <MenuActionItem
                                key={member.id}
                                label={`${member.firstName} ${member.lastName}`.trim()}
                                isActive={member.id === selectedId}
                                leading={
                                    <NameAvatar
                                        firstName={member.firstName}
                                        lastName={member.lastName}
                                        size={18}
                                        colorKey={member.id}
                                    />
                                }
                                onPress={() => onSelect(member.id)}
                            />
                        ))
                    )}
                    {/*
                     * The field is optional and the rules permit clearing it, so
                     * it needs an affordance — a capability with no way to reach
                     * it is dead. Offered only when there is something to clear.
                     * Note this restores the created_by fallback rather than
                     * emptying the row: the card reports to its creator again.
                     */}
                    {selectedId !== undefined && (
                        <MenuActionItem
                            label="Clear reporter"
                            icon={UserMinus}
                            onPress={() => onSelect('')}
                        />
                    )}
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
