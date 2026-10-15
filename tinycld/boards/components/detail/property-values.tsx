import { Avatar } from '@tinycld/core/components/Avatar'
import { LabelBadge } from '@tinycld/core/components/LabelBadge'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useAvatarUrl } from '@tinycld/core/lib/use-avatar-url'
import { CalendarDays, Clock, Gauge, Layers, Timer } from 'lucide-react-native'
import { forwardRef } from 'react'
import { Pressable, Text, View } from 'react-native'
import { dueStateFor, formatDueDate } from '../../lib/due-state'
import { formatSchedule } from '../../lib/due-time'
import { formatEstimate } from '../../lib/estimate'
import { type CardPriority, priorityLabel } from '../../lib/priority'
import { sprintLabel } from '../../lib/sprint'
import type { BoardCardView, BoardEpic, BoardMember, BoardSprint } from '../../types'
import { PriorityGlyph } from '../PriorityGlyph'
import { GhostChip } from './GhostChip'

// The card's property values, each doubling as its picker's trigger. Shared by
// the properties block and the card form's field adapters, so a property reads
// the same wherever it renders.

/** The sprint chip, and the SprintPicker's trigger — the EpicValue shape. */
export const SprintValue = forwardRef<View, { sprint: BoardSprint | null; onPress?: () => void }>(
    function SprintValue({ sprint, onPress }, ref) {
        const mutedColor = useThemeColor('muted')
        if (!sprint) {
            if (!onPress) return <EmptyValue />
            return <GhostChip ref={ref} label="Add to sprint" onPress={onPress} />
        }

        const chipContent = (
            <>
                <Timer size={12} color={mutedColor} strokeWidth={2.2} />
                <Text className="text-[12.5px] font-medium text-foreground">
                    {sprintLabel(sprint)}
                </Text>
            </>
        )

        if (!onPress) {
            return (
                <View className="flex-row items-center gap-[5px] rounded-md px-2 py-[3px] bg-foreground/[0.06]">
                    {chipContent}
                </View>
            )
        }

        return (
            <Pressable
                ref={ref}
                accessibilityRole="button"
                accessibilityLabel={`Sprint ${sprintLabel(sprint)}. Change sprint`}
                testID="boards-detail-sprint"
                onPress={onPress}
                className="flex-row items-center gap-[5px] rounded-md px-2 py-[3px] bg-foreground/[0.06] web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                {chipContent}
            </Pressable>
        )
    }
)

/** The estimate chip, and the EstimatePicker's trigger — the PriorityValue shape. */
export const EpicValue = forwardRef<View, { epic: BoardEpic | null; onPress?: () => void }>(
    function EpicValue({ epic, onPress }, ref) {
        const mutedColor = useThemeColor('muted')
        if (!epic) {
            if (!onPress) return <EmptyValue />
            return <GhostChip ref={ref} label="Add to epic" onPress={onPress} />
        }

        const chipContent = (
            <>
                <Layers size={12} color={epic.color || mutedColor} strokeWidth={2.2} />
                <Text className="text-[12.5px] font-medium text-foreground">{epic.title}</Text>
            </>
        )

        if (!onPress) {
            return (
                <View className="flex-row items-center gap-[5px] rounded-md px-2 py-[3px] bg-foreground/[0.06]">
                    {chipContent}
                </View>
            )
        }

        return (
            <Pressable
                ref={ref}
                accessibilityRole="button"
                accessibilityLabel={`Epic ${epic.title}. Change epic`}
                onPress={onPress}
                className="flex-row items-center gap-[5px] rounded-md px-2 py-[3px] bg-foreground/[0.06] web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                {chipContent}
            </Pressable>
        )
    }
)

export const EstimateValue = forwardRef<View, { estimate?: number; onPress?: () => void }>(
    function EstimateValue({ estimate, onPress }, ref) {
        const mutedColor = useThemeColor('muted')
        if (estimate === undefined) {
            if (!onPress) return <EmptyValue />
            return <GhostChip ref={ref} label="Set estimate" onPress={onPress} />
        }

        const label = formatEstimate(estimate)
        const chipContent = (
            <>
                <Gauge size={12} color={mutedColor} strokeWidth={2.2} />
                <Text className="text-[12.5px] font-medium text-foreground">{label}</Text>
            </>
        )

        if (!onPress) {
            return (
                <View className="flex-row items-center gap-[5px] rounded-md px-2 py-[3px] bg-foreground/[0.06]">
                    {chipContent}
                </View>
            )
        }

        return (
            <Pressable
                ref={ref}
                accessibilityRole="button"
                accessibilityLabel={`Estimate ${label}. Change estimate`}
                onPress={onPress}
                className="flex-row items-center gap-[5px] rounded-md px-2 py-[3px] bg-foreground/[0.06] web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                {chipContent}
            </Pressable>
        )
    }
)

/**
 * The priority chip, and the PriorityPicker's trigger — the DueValue shape:
 * a Pressable root in every openable state so the picker's trigger has
 * something to clone onPress into, and a plain View when the card is read-only.
 */
export const PriorityValue = forwardRef<View, { priority: CardPriority; onPress?: () => void }>(
    function PriorityValue({ priority, onPress }, ref) {
        if (priority === 'none') {
            if (!onPress) return <EmptyValue />
            return <GhostChip ref={ref} label="Set priority" onPress={onPress} />
        }

        const label = priorityLabel(priority)
        const chipContent = (
            <>
                <PriorityGlyph priority={priority} size={12} />
                <Text className="text-[12.5px] font-medium text-foreground">{label}</Text>
            </>
        )

        if (!onPress) {
            return (
                <View className="flex-row items-center gap-[5px] rounded-md px-2 py-[3px] bg-foreground/[0.06]">
                    {chipContent}
                </View>
            )
        }

        return (
            <Pressable
                ref={ref}
                accessibilityRole="button"
                accessibilityLabel={`Priority ${label}. Change priority`}
                onPress={onPress}
                className="flex-row items-center gap-[5px] rounded-md px-2 py-[3px] bg-foreground/[0.06] web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                {chipContent}
            </Pressable>
        )
    }
)

/** What an empty property shows on a read-only card, in place of a ghost chip. */
export function EmptyValue() {
    return <Text className="text-[12.5px] text-muted">None</Text>
}

/**
 * The reporter chip, and the ReporterPicker's trigger. See AssigneesValue for
 * the one-Pressable rule and what a missing onPress means.
 *
 * `card.reporter` is already the created_by fallback — toBoardCard resolves it
 * — so the empty branch here means the card has no creator either, which is
 * only true of bootstrap-written rows.
 */
export const ReporterValue = forwardRef<View, { card: BoardCardView; onPress?: () => void }>(
    function ReporterValue({ card, onPress }, ref) {
        const reporter = card.reporter

        if (!onPress) {
            if (!reporter) return <EmptyValue />
            return (
                <View className="flex-row flex-wrap items-center gap-1.5">
                    <MemberChip member={reporter} />
                </View>
            )
        }

        if (!reporter) {
            return <GhostChip ref={ref} label="Set reporter" onPress={onPress} />
        }

        return (
            <Pressable
                ref={ref}
                accessibilityRole="button"
                accessibilityLabel="Change reporter"
                onPress={onPress}
                className="flex-row flex-wrap items-center gap-1.5 rounded-full web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                <MemberChip member={reporter} />
            </Pressable>
        )
    }
)

/**
 * The assignee chips, and the AssigneePicker's trigger.
 *
 * A populated row wraps its chips in ONE Pressable rather than returning a
 * fragment: the picker clones its single trigger element to inject onPress and
 * a ref, and a fragment has neither.
 */
export const AssigneesValue = forwardRef<View, { card: BoardCardView; onPress?: () => void }>(
    function AssigneesValue({ card, onPress }, ref) {
        // No onPress means no picker wrapped this value (read-only card):
        // plain content, no button semantics, and no ghost-chip invitation.
        if (!onPress) {
            if (!card.assignees?.length) return <EmptyValue />
            return (
                <View className="flex-row flex-wrap items-center gap-1.5">
                    <AssigneeChips card={card} />
                </View>
            )
        }

        if (!card.assignees?.length) {
            return <GhostChip ref={ref} label="Assign" onPress={onPress} />
        }

        return (
            <Pressable
                ref={ref}
                accessibilityRole="button"
                accessibilityLabel="Change assignees"
                onPress={onPress}
                className="flex-row flex-wrap items-center gap-1.5 rounded-full web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                <AssigneeChips card={card} />
            </Pressable>
        )
    }
)

/** One person, as a pill. Shared by the Reporter and Assignees rows. */
export function MemberChip({ member }: { member: BoardMember }) {
    const avatar = useAvatarUrl({
        id: member.id,
        avatar: member.avatar,
        avatar_crop: member.avatarCrop,
    })

    return (
        <View className="flex-row items-center gap-1.5 bg-foreground/[0.06] rounded-full pl-[3px] pr-2.5 py-[2px]">
            <Avatar
                testID="boards-avatar"
                name={`${member.firstName} ${member.lastName ?? ''}`.trim()}
                email={member.email}
                colorKey={member.id}
                avatar={avatar}
                emoji={member.avatarEmoji || undefined}
                color={member.avatarColor || undefined}
                size={20}
            />
            <Text className="text-[12.5px] font-medium text-foreground">
                {member.firstName} {member.lastName}
            </Text>
        </View>
    )
}

function AssigneeChips({ card }: { card: BoardCardView }) {
    return (
        <>
            {card.assignees.map(member => (
                <MemberChip key={member.id} member={member} />
            ))}
        </>
    )
}

/** The label chips, and the LabelPicker's trigger. See AssigneesValue. */
export const LabelsValue = forwardRef<
    View,
    { card: Pick<BoardCardView, 'labels'>; onPress?: () => void }
>(function LabelsValue({ card, onPress }, ref) {
    if (!onPress) {
        if (!card.labels?.length) return <EmptyValue />
        return (
            <View className="flex-row flex-wrap items-center gap-1.5">
                <LabelChips card={card} />
            </View>
        )
    }

    if (!card.labels?.length) {
        return <GhostChip ref={ref} label="Add label" onPress={onPress} />
    }

    return (
        <Pressable
            ref={ref}
            accessibilityRole="button"
            accessibilityLabel="Change labels"
            onPress={onPress}
            className="flex-row flex-wrap items-center gap-1.5 rounded-full web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            <LabelChips card={card} />
        </Pressable>
    )
})

function LabelChips({ card }: { card: Pick<BoardCardView, 'labels'> }) {
    return (
        <>
            {card.labels.map(label => (
                <LabelBadge key={label.id} name={label.name} color={label.color} />
            ))}
        </>
    )
}

/** The start chip — the DueValue shape, always a plain day. */
export const StartValue = forwardRef<View, { start?: Date; onPress?: () => void }>(
    function StartValue({ start, onPress }, ref) {
        const mutedColor = useThemeColor('muted')
        if (!start) {
            if (!onPress) return <EmptyValue />
            return <GhostChip ref={ref} label="Set start date" onPress={onPress} />
        }
        const label = formatDueDate(start)
        const chipContent = (
            <>
                <CalendarDays size={12} color={mutedColor} strokeWidth={2.2} />
                <Text className="text-[12.5px] font-medium text-foreground">{label}</Text>
            </>
        )
        if (!onPress) {
            return (
                <View
                    accessibilityLabel={`Start ${label}`}
                    className="flex-row items-center gap-[5px] rounded-md px-2 py-[3px] bg-foreground/[0.06]"
                >
                    {chipContent}
                </View>
            )
        }
        return (
            <Pressable
                ref={ref}
                accessibilityRole="button"
                accessibilityLabel={`Start ${label}. Change start date`}
                onPress={onPress}
                className="flex-row items-center gap-[5px] rounded-md px-2 py-[3px] bg-foreground/[0.06] web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                {chipContent}
            </Pressable>
        )
    }
)

/**
 * The due chip — and the DuePicker's trigger, which is why its root is a
 * Pressable in both states: the picker clones its trigger to inject onPress and
 * a ref, so a plain View here would render a chip that cannot be opened.
 */
export const DueValue = forwardRef<View, { due?: Date; dueHasTime: boolean; onPress?: () => void }>(
    function DueValue({ due, dueHasTime, onPress }, ref) {
        const warningColor = useThemeColor('warning')
        const dangerColor = useThemeColor('danger')
        const mutedColor = useThemeColor('muted')

        if (!due) {
            if (!onPress) return <EmptyValue />
            return <GhostChip ref={ref} label="Set due date" onPress={onPress} />
        }

        const state = dueStateFor(due, undefined, dueHasTime)
        const isOverdue = state === 'overdue'
        const color = isOverdue ? dangerColor : state === 'soon' ? warningColor : mutedColor
        const Icon = isOverdue ? Clock : CalendarDays
        const text = formatSchedule(undefined, due, dueHasTime)
        const label = isOverdue ? `${text} · overdue` : text
        const stateClass = isOverdue
            ? 'bg-danger/10'
            : state === 'soon'
              ? 'bg-warning/10'
              : 'bg-foreground/[0.06]'
        const chipContent = (
            <>
                <Icon size={12} color={color} strokeWidth={2.2} />
                <Text className="text-[12.5px] font-medium" style={{ color }}>
                    {label}
                </Text>
            </>
        )

        if (!onPress) {
            return (
                <View
                    accessibilityLabel={`Due ${label}`}
                    className={`flex-row items-center gap-[5px] rounded-md px-2 py-[3px] ${stateClass}`}
                >
                    {chipContent}
                </View>
            )
        }

        return (
            <Pressable
                ref={ref}
                accessibilityRole="button"
                accessibilityLabel={`Due ${label}. Change due date`}
                onPress={onPress}
                className={`flex-row items-center gap-[5px] rounded-md px-2 py-[3px] web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring ${stateClass}`}
            >
                {chipContent}
            </Pressable>
        )
    }
)
