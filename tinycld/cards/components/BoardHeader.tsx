import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Filter } from 'lucide-react-native'
import { Text, View } from 'react-native'
import type { SampleProject } from '../sample-projects'

interface BoardHeaderProps {
    project: SampleProject
    cardCount: number
}

function pluralize(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function BoardHeader({ project, cardCount }: BoardHeaderProps) {
    const subtitle = `${pluralize(cardCount, 'card')} in ${pluralize(project.lists.length, 'list')}`

    return (
        <View className="flex-row items-center gap-3 px-5 pt-3.5 pb-2.5">
            <ProjectTile name={project.name} color={project.color} />
            <View>
                <Text className="text-[17px] font-semibold tracking-tight text-foreground">
                    {project.name}
                </Text>
                <Text className="text-[12.5px] text-muted mt-px">{subtitle}</Text>
            </View>
            <View className="flex-1" />
            <TeamAvatars project={project} />
            <FilterButton />
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

function TeamAvatars({ project }: { project: SampleProject }) {
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

function FilterButton() {
    const mutedColor = useThemeColor('muted')
    return (
        <View className="flex-row items-center gap-1.5 border border-border bg-card rounded-lg px-2.5 py-[5px] ml-2">
            <Filter size={13} color={mutedColor} strokeWidth={2.2} />
            <Text className="text-[12.5px] font-medium text-muted">Filter</Text>
        </View>
    )
}
