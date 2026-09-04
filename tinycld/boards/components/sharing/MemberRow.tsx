import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import { ChevronDown, X } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import type { ProjectMemberRow } from '../../hooks/useProjectMembers'
import { toBoardMember } from '../../lib/board-project'
import type { MemberRowActions } from '../../lib/permissions'
import type { BoardsMemberRole } from '../../types'
import { ROLE_OPTIONS, roleLabel } from './roles'

interface MemberRowProps {
    member: ProjectMemberRow
    /** From memberRowActionsFor — the client half of the last-owner guard:
     *  the sole owner's role menu, remove and leave simply never render. */
    actions: MemberRowActions
    onRoleChange: (membershipId: string, role: BoardsMemberRole) => void
    onRemove: (membershipId: string) => void
    onLeave: () => void
}

/**
 * One roster row: avatar, identity, role control, trailing action. Calendar's
 * MemberRow, with boards' NameAvatar and a "Leave" action on the caller's own
 * row — the member delete rule allows self-removal, and a capability with no
 * affordance is dead.
 */
export function MemberRow({ member, actions, onRoleChange, onRemove, onLeave }: MemberRowProps) {
    const avatar = toBoardMember({ id: member.userId, name: member.name, email: member.email })

    return (
        <View
            testID={`boards-member-row-${member.userId}`}
            className="flex-row items-center gap-3 py-2.5 px-3"
        >
            <NameAvatar
                firstName={avatar.firstName}
                lastName={avatar.lastName}
                size={32}
                colorKey={member.userId}
            />
            <View className="flex-1 min-w-0">
                <View className="flex-row items-center gap-1.5">
                    <Text className="text-[13.5px] font-medium text-foreground" numberOfLines={1}>
                        {member.name || member.email}
                    </Text>
                    {member.isCurrentUser ? (
                        <Text className="text-[12px] text-muted">(you)</Text>
                    ) : null}
                </View>
                {member.name ? (
                    <Text className="text-[12px] text-muted" numberOfLines={1}>
                        {member.email}
                    </Text>
                ) : null}
            </View>
            <RoleControl
                member={member}
                canChangeRole={actions.canChangeRole}
                onRoleChange={onRoleChange}
            />
            <TrailingAction
                member={member}
                actions={actions}
                onRemove={onRemove}
                onLeave={onLeave}
            />
        </View>
    )
}

function RoleControl({
    member,
    canChangeRole,
    onRoleChange,
}: {
    member: ProjectMemberRow
    canChangeRole: boolean
    onRoleChange: (membershipId: string, role: BoardsMemberRole) => void
}) {
    const mutedColor = useThemeColor('muted')

    if (!canChangeRole) {
        return (
            <View className="px-2.5 py-1 rounded-md bg-foreground/[0.06]">
                <Text className="text-[12px] font-medium text-foreground">
                    {roleLabel(member.role)}
                </Text>
            </View>
        )
    }

    return (
        <Menu>
            <Menu.Trigger>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Change role for ${member.name || member.email}`}
                    className="flex-row items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-background web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
                >
                    <Text className="text-[12px] font-medium text-foreground">
                        {roleLabel(member.role)}
                    </Text>
                    <ChevronDown size={14} color={mutedColor} strokeWidth={2.2} />
                </Pressable>
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="end">
                    {ROLE_OPTIONS.map(option => (
                        <Menu.Item
                            key={option.value}
                            onPress={() => onRoleChange(member.membershipId, option.value)}
                        >
                            <Menu.ItemTitle>{option.label}</Menu.ItemTitle>
                        </Menu.Item>
                    ))}
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}

/** Remove (owner acting on someone else), Leave (your own row), or a
 *  fixed-size spacer so rows without either stay aligned. */
function TrailingAction({
    member,
    actions,
    onRemove,
    onLeave,
}: {
    member: ProjectMemberRow
    actions: MemberRowActions
    onRemove: (membershipId: string) => void
    onLeave: () => void
}) {
    const dangerColor = useThemeColor('danger')

    if (actions.canRemove) {
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${member.name || member.email}`}
                onPress={() => onRemove(member.membershipId)}
                hitSlop={8}
                className="p-1.5 rounded-md web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                <X size={16} color={dangerColor} strokeWidth={2.2} />
            </Pressable>
        )
    }

    if (actions.canLeave) {
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Leave board"
                onPress={onLeave}
                hitSlop={8}
                className="p-1.5 rounded-md web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                <Text className="text-[12px] font-medium text-danger">Leave</Text>
            </Pressable>
        )
    }

    return <View style={{ width: 28, height: 28 }} />
}
