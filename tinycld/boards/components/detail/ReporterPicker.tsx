import { Avatar } from '@tinycld/core/components/Avatar'
import { Menu } from '@tinycld/core/ui/menu'
import { UserMinus } from 'lucide-react-native'
import type { ReactElement } from 'react'
import { Text } from 'react-native'
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
        <Menu trigger={children} placement="bottom-start" title="Reporter">
            <EmptyState isVisible={members.length === 0} />
            {members.map(member => (
                <Menu.Item
                    key={member.id}
                    label={`${member.firstName} ${member.lastName}`.trim()}
                    isSelected={member.id === selectedId}
                    leading={
                        <Avatar
                            name={`${member.firstName} ${member.lastName ?? ''}`.trim()}
                            size={18}
                            colorKey={member.id}
                        />
                    }
                    onSelect={() => onSelect(member.id)}
                />
            ))}
            <ClearItem isVisible={selectedId !== undefined} onSelect={onSelect} />
        </Menu>
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
            <Text className="text-[12.5px] text-muted">No project members to report to.</Text>
        </Menu.Custom>
    )
}

/**
 * The field is optional and the rules permit clearing it, so it needs an
 * affordance — a capability with no way to reach it is dead. Offered only when
 * there is something to clear. Note this restores the created_by fallback
 * rather than emptying the row: the card reports to its creator again.
 */
function ClearItem({
    isVisible,
    onSelect,
}: {
    isVisible: boolean
    onSelect: (memberId: string) => void
}) {
    if (!isVisible) return null
    return <Menu.Item label="Clear reporter" icon={UserMinus} onSelect={() => onSelect('')} />
}
