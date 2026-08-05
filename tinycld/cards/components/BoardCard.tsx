import { LabelBadge } from '@tinycld/core/components/LabelBadge'
import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { CalendarDays, CircleCheck, Clock, MessageSquare, SquareCheck } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { dueStateFor, formatDueDate } from '../lib/due-state'
import type { BoardCard as BoardCardData, CardLabel, ProjectMember } from '../sample-projects'

const MAX_LABELS = 3

interface BoardCardProps {
    card: BoardCardData
    isDone?: boolean
}

export function BoardCard({ card, isDone }: BoardCardProps) {
    if (isDone) return <DoneCard title={card.title} />

    return (
        <Pressable
            accessibilityRole="button"
            className="bg-card border border-border rounded-[10px] px-3 py-2.5 gap-1.5 shadow-sm web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring hover:border-muted/50"
        >
            <CardLabels labels={card.labels ?? []} />
            <Text
                className="text-[13.5px] font-medium leading-[18px] text-foreground"
                numberOfLines={3}
            >
                {card.title}
            </Text>
            <CardMeta card={card} />
        </Pressable>
    )
}

function DoneCard({ title }: { title: string }) {
    const successColor = useThemeColor('success')
    return (
        <Pressable
            accessibilityRole="button"
            className="bg-card border border-border rounded-[10px] px-3 py-2.5 shadow-sm web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            <View className="flex-row items-start gap-2">
                <View className="mt-px">
                    <CircleCheck size={14} color={successColor} strokeWidth={2.4} />
                </View>
                <Text className="flex-1 text-[13.5px] leading-[18px] text-muted" numberOfLines={3}>
                    {title}
                </Text>
            </View>
        </Pressable>
    )
}

function CardLabels({ labels }: { labels: CardLabel[] }) {
    if (labels.length === 0) return null

    const visible = labels.slice(0, MAX_LABELS)
    const overflow = labels.length - visible.length
    return (
        <View className="flex-row flex-wrap items-center gap-1">
            {visible.map(label => (
                <LabelBadge key={label.id} name={label.name} color={label.color} />
            ))}
            {overflow > 0 ? (
                <Text className="text-[11px] font-medium text-muted">+{overflow}</Text>
            ) : null}
        </View>
    )
}

function CardMeta({ card }: { card: BoardCardData }) {
    const hasPills = card.due || card.checklist || card.comments
    if (!hasPills && !card.assignees?.length) return null

    return (
        <View className="flex-row items-center gap-2.5 min-h-[20px]">
            <DuePill due={card.due} />
            <ChecklistPill checklist={card.checklist} />
            <CommentsPill count={card.comments} />
            <View className="flex-1" />
            <CardAssignees assignees={card.assignees ?? []} />
        </View>
    )
}

function DuePill({ due }: { due?: Date }) {
    const warningColor = useThemeColor('warning')
    const dangerColor = useThemeColor('danger')
    const mutedColor = useThemeColor('muted')
    if (!due) return null

    const state = dueStateFor(due)
    const label = formatDueDate(due)
    if (state === 'upcoming') {
        return (
            <View className="flex-row items-center gap-1">
                <CalendarDays size={11} color={mutedColor} strokeWidth={2.2} />
                <Text className="text-[11px] font-medium text-muted">{label}</Text>
            </View>
        )
    }

    const isOverdue = state === 'overdue'
    const Icon = isOverdue ? Clock : CalendarDays
    const color = isOverdue ? dangerColor : warningColor
    return (
        <View
            className={`flex-row items-center gap-1 rounded-[5px] px-1.5 py-0.5 -ml-1.5 ${isOverdue ? 'bg-danger/10' : 'bg-warning/10'}`}
        >
            <Icon size={11} color={color} strokeWidth={2.2} />
            <Text
                className={`text-[11px] font-medium ${isOverdue ? 'text-danger' : 'text-warning'}`}
            >
                {label}
            </Text>
        </View>
    )
}

function ChecklistPill({ checklist }: { checklist?: BoardCardData['checklist'] }) {
    const mutedColor = useThemeColor('muted')
    const successColor = useThemeColor('success')
    if (!checklist) return null

    const isComplete = checklist.done === checklist.total
    const color = isComplete ? successColor : mutedColor
    return (
        <View className="flex-row items-center gap-1">
            <SquareCheck size={12} color={color} strokeWidth={2.2} />
            <Text
                className={`text-[11px] font-medium ${isComplete ? 'text-success' : 'text-muted'}`}
            >
                {checklist.done}/{checklist.total}
            </Text>
        </View>
    )
}

function CommentsPill({ count }: { count?: number }) {
    const mutedColor = useThemeColor('muted')
    if (!count) return null

    return (
        <View className="flex-row items-center gap-1">
            <MessageSquare size={12} color={mutedColor} strokeWidth={2.2} />
            <Text className="text-[11px] font-medium text-muted">{count}</Text>
        </View>
    )
}

function CardAssignees({ assignees }: { assignees: ProjectMember[] }) {
    if (assignees.length === 0) return null

    return (
        <View className="flex-row">
            {assignees.map((member, index) => (
                <View
                    key={member.id}
                    className={`rounded-full border-2 border-card ${index > 0 ? '-ml-1.5' : ''}`}
                >
                    <NameAvatar
                        firstName={member.firstName}
                        lastName={member.lastName}
                        size={20}
                        colorKey={member.id}
                    />
                </View>
            ))}
        </View>
    )
}
