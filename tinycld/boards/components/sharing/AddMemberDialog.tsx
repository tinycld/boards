import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { Search, X } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useAddMember } from '../../hooks/useMemberMutations'
import { toBoardMember } from '../../lib/board-project'
import type { BoardsMemberRole } from '../../types'
import { ROLE_OPTIONS } from './roles'

interface AddMemberDialogProps {
    isVisible: boolean
    projectId: string
    existingUserIds: Set<string>
    onClose: () => void
}

interface Candidate {
    userId: string
    name: string
    email: string
}

/**
 * The org-roster picker: search users, pick a role, add. Calendar's
 * AddMemberDialog, minus its per-member color.
 *
 * Deliberately org-users-only — no contact/email invites. Drive's version
 * batches through a Go endpoint because it must mint a user for an invited
 * contact email; boards has no such endpoint and a boards member is always an
 * existing users row. If contact invites ever matter here they ride on M6a's
 * visitor-identity work, not this dialog.
 */
export function AddMemberDialog({
    isVisible,
    projectId,
    existingUserIds,
    onClose,
}: AddMemberDialogProps) {
    const [query, setQuery] = useState('')
    const [role, setRole] = useState<BoardsMemberRole>('viewer')
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [usersCollection] = useStore('users')

    const { data: candidatesRaw } = useOrgLiveQuery(q =>
        q.from({ user: usersCollection }).select(({ user }) => ({
            userId: user.id,
            name: user.name,
            email: user.email,
        }))
    )

    const candidates = useMemo(() => {
        const trimmed = query.trim().toLowerCase()
        return (candidatesRaw ?? [])
            .filter(candidate => !existingUserIds.has(candidate.userId))
            .filter(candidate => {
                if (!trimmed) return true
                return (
                    (candidate.name ?? '').toLowerCase().includes(trimmed) ||
                    (candidate.email ?? '').toLowerCase().includes(trimmed)
                )
            })
            .slice(0, 20)
    }, [candidatesRaw, existingUserIds, query])

    const reset = () => {
        setQuery('')
        setRole('viewer')
        setErrorMessage(null)
    }

    const addMember = useAddMember(projectId, {
        onSuccess: () => {
            reset()
            onClose()
        },
        onError: error => {
            setErrorMessage(error instanceof Error ? error.message : 'Failed to add member')
        },
    })

    const handleAdd = (userId: string) => {
        setErrorMessage(null)
        addMember.mutate({ userId, role })
    }

    const handleClose = () => {
        reset()
        onClose()
    }

    if (!isVisible) return null

    return (
        <Modal isOpen onClose={handleClose}>
            <ModalBackdrop />
            <ModalContent className="w-[90%] max-w-[440px] max-h-[560px] p-0 rounded-xl">
                <DialogHeader onClose={handleClose} />
                <View className="px-4 pt-3 pb-2 gap-3">
                    <SearchRow query={query} onChange={setQuery} />
                    <RolePicker role={role} onChange={setRole} />
                    {errorMessage ? (
                        <View className="px-3 py-2 rounded-md bg-danger/10">
                            <Text className="text-[12px] text-danger">{errorMessage}</Text>
                        </View>
                    ) : null}
                </View>
                <CandidateList
                    candidates={candidates}
                    hasQuery={query.trim().length > 0}
                    isPending={addMember.isPending}
                    onAdd={handleAdd}
                />
            </ModalContent>
        </Modal>
    )
}

function DialogHeader({ onClose }: { onClose: () => void }) {
    const mutedColor = useThemeColor('muted')
    return (
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
            <Text className="text-[15px] font-semibold text-foreground">Add people</Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={onClose}
                className="p-1"
            >
                <X size={16} color={mutedColor} strokeWidth={2.2} />
            </Pressable>
        </View>
    )
}

function SearchRow({ query, onChange }: { query: string; onChange: (value: string) => void }) {
    const mutedColor = useThemeColor('muted')
    return (
        <View className="flex-row items-center gap-2 px-3 py-2 rounded-md border border-border bg-background">
            <Search size={15} color={mutedColor} strokeWidth={2.2} />
            <PlainInput
                value={query}
                onChangeText={onChange}
                placeholder="Search by name or email"
                placeholderTextColor={mutedColor}
                autoFocus
                className="flex-1 text-[13.5px] text-foreground"
            />
        </View>
    )
}

function RolePicker({
    role,
    onChange,
}: {
    role: BoardsMemberRole
    onChange: (role: BoardsMemberRole) => void
}) {
    return (
        <View className="flex-row gap-1.5 items-center flex-wrap">
            <Text className="text-[12px] text-muted">Role:</Text>
            {ROLE_OPTIONS.map(option => (
                <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: role === option.value }}
                    accessibilityLabel={`${option.label} — ${option.description}`}
                    onPress={() => onChange(option.value)}
                    className={
                        role === option.value
                            ? 'px-2.5 py-1 rounded-md bg-primary'
                            : 'px-2.5 py-1 rounded-md border border-border'
                    }
                >
                    <Text
                        className={
                            role === option.value
                                ? 'text-[12px] text-primary-foreground'
                                : 'text-[12px] text-foreground'
                        }
                    >
                        {option.label}
                    </Text>
                </Pressable>
            ))}
        </View>
    )
}

function CandidateList({
    candidates,
    hasQuery,
    isPending,
    onAdd,
}: {
    candidates: Candidate[]
    hasQuery: boolean
    isPending: boolean
    onAdd: (userId: string) => void
}) {
    if (candidates.length === 0) {
        return (
            <View className="px-4 py-6">
                <Text className="text-[13px] text-muted">
                    {hasQuery ? 'No matching people' : 'Everyone is already on this board'}
                </Text>
            </View>
        )
    }

    return (
        <ScrollView className="max-h-[340px]" contentContainerStyle={{ paddingBottom: 12 }}>
            {candidates.map(candidate => (
                <CandidateRow
                    key={candidate.userId}
                    candidate={candidate}
                    isPending={isPending}
                    onAdd={onAdd}
                />
            ))}
        </ScrollView>
    )
}

function CandidateRow({
    candidate,
    isPending,
    onAdd,
}: {
    candidate: Candidate
    isPending: boolean
    onAdd: (userId: string) => void
}) {
    const avatar = toBoardMember({
        id: candidate.userId,
        name: candidate.name,
        email: candidate.email,
    })

    return (
        <View className="flex-row items-center gap-3 px-4 py-2.5">
            <NameAvatar
                firstName={avatar.firstName}
                lastName={avatar.lastName}
                size={30}
                colorKey={candidate.userId}
            />
            <View className="flex-1 min-w-0">
                <Text className="text-[13.5px] font-medium text-foreground" numberOfLines={1}>
                    {candidate.name || candidate.email}
                </Text>
                {candidate.name ? (
                    <Text className="text-[12px] text-muted" numberOfLines={1}>
                        {candidate.email}
                    </Text>
                ) : null}
            </View>
            <Button size="sm" onPress={() => onAdd(candidate.userId)} isDisabled={isPending}>
                <ButtonText>{isPending ? 'Adding…' : 'Add'}</ButtonText>
            </Button>
        </View>
    )
}
