import { useAuth } from '@tinycld/core/lib/auth'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { Dialog } from '@tinycld/core/ui/dialog'
import { UserPlus } from 'lucide-react-native'
import { useState } from 'react'
import { Text, View } from 'react-native'
import { useChangeMemberRole, useRemoveMember } from '../../hooks/useMemberMutations'
import { type ProjectMemberRow, useProjectMembers } from '../../hooks/useProjectMembers'
import { useProjectRole } from '../../hooks/useProjectRole'
import { memberRowActionsFor } from '../../lib/permissions'
import type { BoardProject, BoardsMemberRole } from '../../types'
import { AddMemberDialog } from './AddMemberDialog'
import { MemberRow } from './MemberRow'
import { ShareLinkSection } from './ShareLinkSection'

interface ShareDialogProps {
    isVisible: boolean
    onClose: () => void
    project: BoardProject
}

/**
 * The board's member roster and, for owners, its management: add people,
 * change roles, remove members. Any non-guest member can open it read-only —
 * the avatar stack is a "who is on this board" affordance before it is a
 * sharing one.
 *
 * The per-row actions come from memberRowActionsFor, which is the CLIENT
 * last-owner guard: the sole owner's demote/remove/leave never render. The
 * server hook (server/member_owner_guard.go) backs this at the API, which is
 * where a caller who bypasses this dialog lands. The two cover different paths
 * — do not simplify either away.
 *
 * Share links live in the owner-only General access section at the foot of the
 * roster (M6a). Everything above it is about people who already have accounts;
 * that section is about handing access to someone who does not.
 */
export function ShareDialog({ isVisible, onClose, project }: ShareDialogProps) {
    if (!isVisible) return null
    return <ShareDialogContent onClose={onClose} project={project} />
}

function ShareDialogContent({ onClose, project }: { onClose: () => void; project: BoardProject }) {
    // Non-throwing for consistency with the hooks below, which are shared with
    // the public board. This dialog itself is owner-only and never opens
    // without a session; `user?.id ?? ''` already handles the impossible case.
    const { user } = useAuth({ throwIfAnon: false })
    const { isOwner } = useProjectRole(project.id)
    // The ORG axis, not the project one: an org-guest reads no roster by rule.
    const { isGuest, isReady: orgRoleReady } = useCurrentRole()
    const { members, ownerCount } = useProjectMembers(project.id)
    const [isAdding, setIsAdding] = useState(false)
    const [isLeaving, setIsLeaving] = useState(false)
    const fgColor = useThemeColor('foreground')

    const { actionError, changeRole, removeMember, leaveBoard } = useMemberActions(onClose)

    const actionsFor = (member: ProjectMemberRow) =>
        memberRowActionsFor({
            rowRole: member.role,
            rowUserId: member.userId,
            currentUserId: user?.id ?? '',
            callerIsOwner: isOwner,
            ownerCount,
        })

    const onRoleChange = (membershipId: string, role: BoardsMemberRole) =>
        changeRole.mutate({ membershipId, role })

    return (
        <Dialog isOpen onClose={onClose} title={`Share “${project.name}”`} size="lg">
            <ActionError message={actionError} />
            <Dialog.Body contentClassName="px-5 pb-3">
                <View className="rounded-xl border border-border overflow-hidden">
                    {members.map((member, index) => (
                        <View
                            key={member.membershipId}
                            className={index > 0 ? 'border-t border-border' : ''}
                        >
                            <MemberRow
                                member={member}
                                actions={actionsFor(member)}
                                onRoleChange={onRoleChange}
                                onRemove={membershipId => removeMember.mutate(membershipId)}
                                onLeave={() => setIsLeaving(true)}
                            />
                        </View>
                    ))}
                </View>
                <GuestRosterNote isVisible={isGuest && orgRoleReady} />
                <ShareLinkSection projectId={project.id} isVisible={isOwner} />
            </Dialog.Body>
            <Dialog.Footer>
                <AddPeopleButton
                    isVisible={isOwner}
                    color={fgColor}
                    onPress={() => setIsAdding(true)}
                />
                <View className="flex-1" />
                <Dialog.ActionButton label="Done" onPress={onClose} />
            </Dialog.Footer>

            <AddMemberDialog
                isVisible={isAdding}
                projectId={project.id}
                existingUserIds={new Set(members.map(member => member.userId))}
                onClose={() => setIsAdding(false)}
            />
            <LeaveConfirm
                isOpen={isLeaving}
                projectName={project.name}
                onClose={() => setIsLeaving(false)}
                onConfirm={() => {
                    const ownRow = members.find(member => member.isCurrentUser)
                    if (ownRow) leaveBoard.mutate(ownRow.membershipId)
                }}
                isSubmitting={leaveBoard.isPending}
            />
        </Dialog>
    )
}

function ActionError({ message }: { message: string | null }) {
    if (!message) return null
    return (
        <View className="mx-5 mb-3 px-3 py-2 rounded-md bg-danger/10">
            <Text className="text-[12px] text-danger">{message}</Text>
        </View>
    )
}

function AddPeopleButton({
    isVisible,
    color,
    onPress,
}: {
    isVisible: boolean
    color: string
    onPress: () => void
}) {
    if (!isVisible) return null
    return (
        <Button size="sm" variant="outline" onPress={onPress}>
            <UserPlus size={14} color={color} strokeWidth={2.2} />
            <ButtonText>Add people</ButtonText>
        </Button>
    )
}

/**
 * The dialog's three membership mutations sharing one error banner. A refusal
 * keeps the dialog open with the message in place — closing would report a
 * success the user didn't get. The server last-owner guard's message surfaces
 * here verbatim.
 */
function useMemberActions(onLeft: () => void) {
    const [actionError, setActionError] = useState<string | null>(null)
    const clearError = () => setActionError(null)
    const onError = (error: unknown) =>
        setActionError(error instanceof Error ? error.message : 'Something went wrong')

    const changeRole = useChangeMemberRole({ onSuccess: clearError, onError })
    const removeMember = useRemoveMember({ onSuccess: clearError, onError })
    const leaveBoard = useRemoveMember({ onSuccess: onLeft, onError })
    return { actionError, changeRole, removeMember, leaveBoard }
}

/**
 * What an org-level guest sees under their solitary roster row. The roster
 * rule is member-AND-non-guest, so a guest's query legally returns exactly one
 * row (their own) — explained rather than left looking broken. Gated on the
 * org role being settled so it cannot flash at a full member on a cold load.
 */
function GuestRosterNote({ isVisible }: { isVisible: boolean }) {
    if (!isVisible) return null
    return (
        <Text className="text-[12px] text-muted mt-2 px-1">
            The rest of the member list is hidden for guests of this workspace.
        </Text>
    )
}

/** Leaving loses access outright, so it gets the confirm a remove-other does
 *  not — the owner removing someone can always re-add them. */
function LeaveConfirm({
    isOpen,
    projectName,
    onClose,
    onConfirm,
    isSubmitting,
}: {
    isOpen: boolean
    projectName: string
    onClose: () => void
    onConfirm: () => void
    isSubmitting: boolean
}) {
    return (
        <ConfirmDialog
            isOpen={isOpen}
            onClose={onClose}
            onConfirm={onConfirm}
            title={`Leave “${projectName}”?`}
            message="You'll lose access to this board unless someone shares it with you again."
            confirmLabel="Leave board"
            isDestructive
            isSubmitting={isSubmitting}
        />
    )
}
