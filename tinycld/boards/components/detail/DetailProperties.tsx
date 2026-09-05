import { LabelBadge } from '@tinycld/core/components/LabelBadge'
import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { CalendarDays, Clock, Gauge, Layers, Timer } from 'lucide-react-native'
import { forwardRef, type ReactElement, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useToggleCardRelation, useUpdateCard } from '../../hooks/useCardMutations'
import { dueStateFor, formatDueDate } from '../../lib/due-state'
import { formatSchedule } from '../../lib/due-time'
import { formatEstimate } from '../../lib/estimate'
import { type CardPriority, priorityLabel } from '../../lib/priority'
import { sprintLabel } from '../../lib/sprint'
import type { BoardCardView, BoardEpic, BoardLabel, BoardMember, BoardSprint } from '../../types'
import { PriorityGlyph } from '../PriorityGlyph'
import { AssigneePicker } from './AssigneePicker'
import { DuePicker } from './DuePicker'
import { EpicPicker } from './EpicPicker'
import { EstimatePicker } from './EstimatePicker'
import { LabelPicker } from './LabelPicker'
import { PriorityPicker } from './PriorityPicker'
import { ReporterPicker } from './ReporterPicker'
import { SprintPicker } from './SprintPicker'

interface DetailPropertiesProps {
    card: BoardCardView
    /** The board's labels — the picker offers these, not the card's own. */
    projectLabels: BoardLabel[]
    /** The board's epics — the picker offers these, not the card's own. */
    projectEpics: BoardEpic[]
    /** The board's sprints, and whether the board plans in them at all. */
    projectSprints: BoardSprint[]
    sprintsEnabled: boolean
    /** The board's roster, so a card is only assignable to someone who can open it. */
    projectMembers: BoardMember[]
    onManageLabels: () => void
    /** When false the values render bare — no picker Menus, no ghost chips. */
    canEdit: boolean
}

export function DetailProperties({
    card,
    projectLabels,
    projectEpics,
    projectSprints,
    sprintsEnabled,
    projectMembers,
    onManageLabels,
    canEdit,
}: DetailPropertiesProps) {
    const updateCard = useUpdateCard()
    const toggleRelation = useToggleCardRelation()

    const toggle = (field: 'labels' | 'assignees') => (id: string, isSelected: boolean) =>
        toggleRelation.mutate({ cardId: card.id, field, id, isSelected })

    // The Value components double as the pickers' Menu.Trigger children; a
    // trigger injects onPress by cloning, so rendering one bare (no picker
    // wrapper, no onPress) is what makes it read-only — see their no-onPress
    // branches.
    if (!canEdit) {
        return (
            <View className="gap-3 mb-[22px]">
                <PropertyRow name="Reporter">
                    <ReporterValue card={card} />
                </PropertyRow>
                <PropertyRow name="Assignees">
                    <AssigneesValue card={card} />
                </PropertyRow>
                <PropertyRow name="Labels">
                    <LabelsValue card={card} />
                </PropertyRow>
                <PropertyRow name="Epic">
                    <EpicValue epic={card.epic} />
                </PropertyRow>
                <SprintPropertyRow isVisible={sprintsEnabled}>
                    <SprintValue sprint={card.sprint} />
                </SprintPropertyRow>
                <PropertyRow name="Start">
                    <StartValue start={card.start} />
                </PropertyRow>
                <PropertyRow name="Due">
                    <DueValue due={card.due} dueHasTime={card.dueHasTime} />
                </PropertyRow>
                <PropertyRow name="Priority">
                    <PriorityValue priority={card.priority} />
                </PropertyRow>
                <PropertyRow name="Estimate">
                    <EstimateValue estimate={card.estimate} />
                </PropertyRow>
            </View>
        )
    }

    return (
        <View className="gap-3 mb-[22px]">
            <PropertyRow name="Reporter">
                <ReporterPicker
                    members={projectMembers}
                    selectedId={card.reporter?.id}
                    onSelect={reporter => updateCard.mutate({ cardId: card.id, reporter })}
                >
                    <ReporterValue card={card} />
                </ReporterPicker>
            </PropertyRow>
            <PropertyRow name="Assignees">
                <AssigneePicker
                    members={projectMembers}
                    assignedIds={card.assignees.map(member => member.id)}
                    onToggle={toggle('assignees')}
                >
                    <AssigneesValue card={card} />
                </AssigneePicker>
            </PropertyRow>
            <PropertyRow name="Labels">
                <LabelPicker
                    labels={projectLabels}
                    selectedIds={card.labels.map(label => label.id)}
                    onToggle={toggle('labels')}
                    onManage={onManageLabels}
                >
                    <LabelsValue card={card} />
                </LabelPicker>
            </PropertyRow>
            <PropertyRow name="Epic">
                <EpicPicker
                    epics={projectEpics}
                    selectedId={card.epic?.id ?? ''}
                    onSelect={epic => updateCard.mutate({ cardId: card.id, epic })}
                >
                    <EpicValue epic={card.epic} />
                </EpicPicker>
            </PropertyRow>
            <SprintPropertyRow isVisible={sprintsEnabled}>
                <SprintPicker
                    sprints={projectSprints}
                    selectedId={card.sprint?.id ?? ''}
                    onSelect={sprint => updateCard.mutate({ cardId: card.id, sprint })}
                >
                    <SprintValue sprint={card.sprint} />
                </SprintPicker>
            </SprintPropertyRow>
            <PropertyRow name="Start">
                <DuePicker
                    value={card.start}
                    onChange={pick => updateCard.mutate({ cardId: card.id, start: pick.date })}
                >
                    <StartValue start={card.start} />
                </DuePicker>
            </PropertyRow>
            <PropertyRow name="Due">
                <DuePicker
                    value={card.due}
                    hasTime={card.dueHasTime}
                    allowTime
                    onChange={pick =>
                        updateCard.mutate({
                            cardId: card.id,
                            due: pick.date,
                            dueHasTime: pick.hasTime,
                        })
                    }
                >
                    <DueValue due={card.due} dueHasTime={card.dueHasTime} />
                </DuePicker>
            </PropertyRow>
            <PropertyRow name="Priority">
                <PriorityPicker
                    selected={card.priority}
                    onSelect={priority => updateCard.mutate({ cardId: card.id, priority })}
                >
                    <PriorityValue priority={card.priority} />
                </PriorityPicker>
            </PropertyRow>
            <PropertyRow name="Estimate">
                <EstimatePicker
                    selected={card.estimate}
                    onSelect={estimate => updateCard.mutate({ cardId: card.id, estimate })}
                >
                    <EstimateValue estimate={card.estimate} />
                </EstimatePicker>
            </PropertyRow>
        </View>
    )
}

/** The Sprint row, only on a board that plans in sprints. */
function SprintPropertyRow({
    isVisible,
    children,
}: {
    isVisible: boolean
    children: ReactElement
}) {
    if (!isVisible) return null
    return <PropertyRow name="Sprint">{children}</PropertyRow>
}

/** The sprint chip, and the SprintPicker's trigger — the EpicValue shape. */
const SprintValue = forwardRef<View, { sprint: BoardSprint | null; onPress?: () => void }>(
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
const EpicValue = forwardRef<View, { epic: BoardEpic | null; onPress?: () => void }>(
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

const EstimateValue = forwardRef<View, { estimate?: number; onPress?: () => void }>(
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
 * a Pressable root in every openable state so Menu.Trigger has something to
 * clone onPress into, and a plain View when the card is read-only.
 */
const PriorityValue = forwardRef<View, { priority: CardPriority; onPress?: () => void }>(
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
function EmptyValue() {
    return <Text className="text-[12.5px] text-muted">None</Text>
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

const GhostChip = forwardRef<View, { label: string; onPress?: () => void }>(function GhostChip(
    { label, onPress },
    ref
) {
    return (
        <Pressable
            ref={ref}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            className="border border-dashed border-border rounded-full px-2.5 py-[3px] hover:border-muted web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            <Text className="text-[12px] font-medium text-muted">{label}</Text>
        </Pressable>
    )
})

/**
 * The reporter chip, and the ReporterPicker's trigger. See AssigneesValue for
 * the one-Pressable rule and what a missing onPress means.
 *
 * `card.reporter` is already the created_by fallback — toBoardCard resolves it
 * — so the empty branch here means the card has no creator either, which is
 * only true of bootstrap-written rows.
 */
const ReporterValue = forwardRef<View, { card: BoardCardView; onPress?: () => void }>(
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
 * fragment: Menu.Trigger clones a single child to inject onPress and a ref, and
 * a fragment has neither.
 */
const AssigneesValue = forwardRef<View, { card: BoardCardView; onPress?: () => void }>(
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
function MemberChip({ member }: { member: BoardMember }) {
    return (
        <View className="flex-row items-center gap-1.5 bg-foreground/[0.06] rounded-full pl-[3px] pr-2.5 py-[2px]">
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
const LabelsValue = forwardRef<View, { card: BoardCardView; onPress?: () => void }>(
    function LabelsValue({ card, onPress }, ref) {
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
    }
)

function LabelChips({ card }: { card: BoardCardView }) {
    return (
        <>
            {card.labels.map(label => (
                <LabelBadge key={label.id} name={label.name} color={label.color} />
            ))}
        </>
    )
}

/** The start chip — the DueValue shape, always a plain day. */
const StartValue = forwardRef<View, { start?: Date; onPress?: () => void }>(function StartValue(
    { start, onPress },
    ref
) {
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
})

/**
 * The due chip — and the DuePicker's trigger, which is why its root is a
 * Pressable in both states: Menu.Trigger clones its child to inject onPress and
 * a ref, so a plain View here would render a chip that cannot be opened.
 */
const DueValue = forwardRef<View, { due?: Date; dueHasTime: boolean; onPress?: () => void }>(
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
