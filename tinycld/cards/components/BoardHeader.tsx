import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { useState } from 'react'
import { Text, View } from 'react-native'
import { useUpdateProject } from '../hooks/useProjectMutations'
import type { BoardProject } from '../types'
import { BoardMenu } from './BoardMenu'

interface BoardHeaderProps {
    project: BoardProject
    cardCount: number
}

function pluralize(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function BoardHeader({ project, cardCount }: BoardHeaderProps) {
    const [isRenaming, setIsRenaming] = useState(false)
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
            <View className="flex-1" />
            <TeamAvatars project={project} />
            <BoardMenu project={project} onRename={() => setIsRenaming(true)} />
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

function TeamAvatars({ project }: { project: BoardProject }) {
    if (project.members.length === 0) return null

    return (
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
}

// The Filter button that used to live here was removed: it was a plain View —
// not even pressable — and dead chrome that looks like a control is worse than
// an absent one. Board filtering is a filed follow-up (TODO.md M7), and search
// is its own M3 task with a core-sharing question attached.
