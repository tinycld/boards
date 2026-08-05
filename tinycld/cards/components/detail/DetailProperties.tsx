import { LabelBadge } from '@tinycld/core/components/LabelBadge'
import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { CalendarDays, Clock } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { dueStateFor, formatDueDate } from '../../lib/due-state'
import type { BoardCardView } from '../../types'

interface DetailPropertiesProps {
    card: BoardCardView
}

export function DetailProperties({ card }: DetailPropertiesProps) {
    return (
        <View className="gap-3 mb-[22px]">
            <PropertyRow name="Assignees">
                <AssigneesValue card={card} />
            </PropertyRow>
            <PropertyRow name="Labels">
                <LabelsValue card={card} />
            </PropertyRow>
            <PropertyRow name="Due">
                <DueValue due={card.due} />
            </PropertyRow>
        </View>
    )
}

function PropertyRow({ name, children }: { name: string; children: ReactNode }) {
    return (
        <View className="flex-row items-start gap-3">
            <Text className="w-[92px] shrink-0 text-[12px] font-medium text-muted pt-[3px]">
                {name}
            </Text>
            <View className="flex-1 flex-row flex-wrap items-center gap-1.5">{children}</View>
        </View>
    )
}

function GhostChip({ label }: { label: string }) {
    return (
        <Pressable
            accessibilityRole="button"
            className="border border-dashed border-border rounded-full px-2.5 py-[3px] hover:border-muted web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            <Text className="text-[12px] font-medium text-muted">{label}</Text>
        </Pressable>
    )
}

function AssigneesValue({ card }: { card: BoardCardView }) {
    if (!card.assignees?.length) return <GhostChip label="Assign" />

    return (
        <>
            {card.assignees.map(member => (
                <View
                    key={member.id}
                    className="flex-row items-center gap-1.5 bg-foreground/[0.06] rounded-full pl-[3px] pr-2.5 py-[2px]"
                >
                    <NameAvatar
                        firstName={member.firstName}
                        lastName={member.lastName}
                        size={20}
                        colorKey={member.id}
                    />
                    <Text className="text-[12.5px] font-medium text-foreground">
                        {member.firstName} {member.lastName}
                    </Text>
                </View>
            ))}
        </>
    )
}

function LabelsValue({ card }: { card: BoardCardView }) {
    if (!card.labels?.length) return <GhostChip label="Add label" />

    return (
        <>
            {card.labels.map(label => (
                <LabelBadge key={label.id} name={label.name} color={label.color} />
            ))}
            <GhostChip label="+" />
        </>
    )
}

function DueValue({ due }: { due?: Date }) {
    const warningColor = useThemeColor('warning')
    const dangerColor = useThemeColor('danger')
    const mutedColor = useThemeColor('muted')
    if (!due) return <GhostChip label="Set due date" />

    const state = dueStateFor(due)
    const isOverdue = state === 'overdue'
    const color = isOverdue ? dangerColor : state === 'soon' ? warningColor : mutedColor
    const Icon = isOverdue ? Clock : CalendarDays
    const label = isOverdue ? `${formatDueDate(due)} · overdue` : formatDueDate(due)
    const stateClass = isOverdue
        ? 'bg-danger/10'
        : state === 'soon'
          ? 'bg-warning/10'
          : 'bg-foreground/[0.06]'
    return (
        <View className={`flex-row items-center gap-[5px] rounded-md px-2 py-[3px] ${stateClass}`}>
            <Icon size={12} color={color} strokeWidth={2.2} />
            <Text className="text-[12.5px] font-medium" style={{ color }}>
                {label}
            </Text>
        </View>
    )
}
