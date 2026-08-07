import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useUpdateProject } from '../hooks/useProjectMutations'
import { useProjectRole } from '../hooks/useProjectRole'
import type { BoardProject, CardsMemberRole } from '../types'
import { BoardMenu } from './BoardMenu'
import { roleLabel } from './sharing/roles'
import { ShareDialog } from './sharing/ShareDialog'

interface BoardHeaderProps {
    project: BoardProject
    cardCount: number
}

function pluralize(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function BoardHeader({ project, cardCount }: BoardHeaderProps) {
    const [isRenaming, setIsRenaming] = useState(false)
    const [isSharing, setIsSharing] = useState(false)
    const { isOwner, role, isReady, canEdit } = useProjectRole(project.id)
    // The ORG axis: a share-link guest cannot read the roster, so for them the
    // stack stays a plain display instead of opening an empty dialog.
    const { isGuest } = useCurrentRole()
    const subtitle = `${pluralize(cardCount, 'card')} in ${pluralize(project.lists.length, 'list')}`

    return (
        <View className="flex-row items-center gap-3 px-5 pt-3.5 pb-2.5">
            <ProjectTile name={project.name} color={project.color} />
            <View className="shrink">
                {isRenaming ? (
                    // Keyed on the name so each rename mounts a fresh input
                    // seeded from the current value — see BoardColumn for the
                    // same pattern and the stale-draft bug it avoids.
                    <BoardNameInput
                        key={project.name}
                        project={project}
                        onDone={() => setIsRenaming(false)}
                    />
                ) : (
                    <Text className="text-[17px] font-semibold tracking-tight text-foreground">
                        {project.name}
                    </Text>
                )}
                <Text className="text-[12.5px] text-muted mt-px">{subtitle}</Text>
            </View>
            <RoleChip role={role} isVisible={isReady && !canEdit} />
            <View className="flex-1" />
            <TeamAvatars
                project={project}
                onPress={isGuest ? undefined : () => setIsSharing(true)}
            />
            {/* Rename, recolor and archive are all owner-only by rule; hiding
                the menu also removes the only rename entry point, so
                BoardNameInput needs no gate of its own. */}
            {isOwner ? <BoardMenu project={project} onRename={() => setIsRenaming(true)} /> : null}
            <ShareDialog
                isVisible={isSharing}
                onClose={() => setIsSharing(false)}
                project={project}
            />
        </View>
    )
}

function BoardNameInput({ project, onDone }: { project: BoardProject; onDone: () => void }) {
    const [draft, setDraft] = useState(project.name)
    const updateProject = useUpdateProject()

    const commit = () => {
        onDone()
        const trimmed = draft.trim()
        if (!trimmed || trimmed === project.name) return
        updateProject.mutate({ projectId: project.id, name: trimmed })
    }

    return (
        <PlainInput
            value={draft}
            onChangeText={setDraft}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={commit}
            onBlur={commit}
            onKeyPress={e => {
                if (e.nativeEvent.key === 'Escape') onDone()
            }}
            className="text-[17px] font-semibold tracking-tight text-foreground"
        />
    )
}

/**
 * Names the caller's role on boards they cannot edit. The affordance gates
 * (no composers, no drag) already ENFORCE read-only; this is the one place
 * that EXPLAINS it — without it a shared board just looks broken ("why can't
 * I drag?"). Visibility gates on `isReady` so it never flashes at an
 * owner/editor during the cold-load null role.
 */
function RoleChip({ role, isVisible }: { role: CardsMemberRole | null; isVisible: boolean }) {
    if (!isVisible || !role) return null
    return (
        <View testID="cards-role-chip" className="bg-foreground/[0.06] rounded-full px-2 py-0.5">
            <Text className="text-[11px] font-semibold text-muted">{roleLabel(role)}</Text>
        </View>
    )
}

function ProjectTile({ name, color }: { name: string; color: string }) {
    return (
        <View
            className="w-[26px] h-[26px] rounded-lg items-center justify-center"
            style={{ backgroundColor: color }}
        >
            <Text className="text-[13px] font-bold text-white">{name[0]?.toUpperCase()}</Text>
        </View>
    )
}

/**
 * The member stack, and — for non-guests — the Share dialog's entry point.
 * A guest gets the plain stack: the roster rule hides the member list from
 * them, so an openable dialog would be an empty promise (and the old Filter
 * button here taught that chrome which looks pressable but isn't is worse
 * than none).
 */
function TeamAvatars({ project, onPress }: { project: BoardProject; onPress?: () => void }) {
    if (project.members.length === 0) return null

    const stack = (
        <View className="flex-row">
            {project.members.map((member, index) => (
                <View
                    key={member.id}
                    className={`rounded-full border-2 border-background ${index > 0 ? '-ml-1.5' : ''}`}
                >
                    <NameAvatar
                        firstName={member.firstName}
                        lastName={member.lastName}
                        size={24}
                        colorKey={member.id}
                    />
                </View>
            ))}
        </View>
    )

    if (!onPress) return stack

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share board"
            onPress={onPress}
            className="rounded-full web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            {stack}
        </Pressable>
    )
}

// The Filter button that used to live here was removed: it was a plain View —
// not even pressable — and dead chrome that looks like a control is worse than
// an absent one. Board filtering is a filed follow-up (TODO.md M7), and search
// is its own M3 task with a core-sharing question attached.
