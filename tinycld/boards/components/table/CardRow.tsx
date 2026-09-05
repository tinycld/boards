import { LabelBadge } from '@tinycld/core/components/LabelBadge'
import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { CalendarDays, Clock, Gauge } from 'lucide-react-native'
import { type GestureResponderEvent, Pressable, Text, View } from 'react-native'
import { dueStateFor, formatDueDate } from '../../lib/due-state'
import { formatSchedule } from '../../lib/due-time'
import { formatEstimate } from '../../lib/estimate'
import type { ListCategory } from '../../lib/list-category'
import { priorityLabel } from '../../lib/priority'
import type { BoardCardView, BoardMember } from '../../types'
import { CategoryGlyph } from '../CategoryGlyph'
import { PriorityGlyph } from '../PriorityGlyph'

export interface CardRowBoard {
    id: string
    name: string
    color: string
}

interface CardRowProps {
    card: BoardCardView
    listName: string
    listCategory: ListCategory
    /** Present on the cross-board list; the board's own table omits it. */
    board?: CardRowBoard
    /** `table` lays cells out under DataTableHeader; `stacked` is the phone row. */
    variant: 'table' | 'stacked'
    isFocused?: boolean
    /** Omitted on the cross-board list, which has no bulk actions. */
    isSelected?: boolean
    onPress: (event: GestureResponderEvent) => void
}

/** Column widths, shared with BoardTable's header so the tracks line up. */
export const TABLE_COLUMNS = {
    key: 92,
    title: 3,
    list: 1.2,
    assignees: 96,
    labels: 1.6,
    start: 96,
    due: 120,
    priority: 96,
    estimate: 80,
} as const

/**
 * One card as a row — the board's table view and the cross-board list share
 * it, so a card reads the same wherever it is listed. Cells reuse the face's
 * pieces (label badges, avatars, the due colouring) rather than restating
 * them.
 */
export function CardRow({
    card,
    listName,
    listCategory,
    board,
    variant,
    isFocused = false,
    isSelected = false,
    onPress,
}: CardRowProps) {
    // Selection outranks focus, and tints more strongly — the same ladder the
    // card face uses, for the same reason: a run of selected rows has to read
    // at a glance, and at most one of them is the focused one.
    const ring = isSelected ? 'bg-primary/10' : isFocused ? 'bg-foreground/[0.04]' : ''
    if (variant === 'stacked') {
        return (
            <Pressable
                accessibilityRole="button"
                testID={`boards-row-${card.id}`}
                onPress={onPress}
                className={`px-4 py-2.5 border-b border-border gap-1 ${ring}`}
            >
                <FocusMarker isFocused={isFocused} cardId={card.id} />
                <SelectedMarker isSelected={isSelected} cardId={card.id} />
                <SelectedMarker isSelected={isSelected} cardId={card.id} />
                <View className="flex-row items-center gap-2">
                    <PriorityGlyph priority={card.priority} size={12} />
                    <Text
                        className="flex-1 text-[14px] font-medium text-foreground"
                        numberOfLines={2}
                    >
                        {card.title}
                    </Text>
                    <Assignees assignees={card.assignees} />
                </View>
                <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
                    <BoardTile board={board} />
                    <CategoryGlyph category={listCategory} size={11} />
                    <Meta text={[card.key, listName].filter(Boolean).join(' · ')} />
                    <DueCell start={card.start} due={card.due} dueHasTime={card.dueHasTime} />
                    <EstimateCell estimate={card.estimate} />
                    <Labels card={card} />
                </View>
            </Pressable>
        )
    }

    return (
        <Pressable
            accessibilityRole="button"
            testID={`boards-row-${card.id}`}
            onPress={onPress}
            className={`flex-row items-center px-3 py-2 border-b border-border hover:bg-foreground/[0.03] ${ring}`}
        >
            <FocusMarker isFocused={isFocused} cardId={card.id} />
            <View style={{ width: TABLE_COLUMNS.key }}>
                <Meta text={card.key} />
            </View>
            <View
                style={{ flex: TABLE_COLUMNS.title }}
                className="flex-row items-center gap-2 pr-3"
            >
                <BoardTile board={board} />
                <Text
                    className="flex-1 text-[13.5px] font-medium text-foreground"
                    numberOfLines={1}
                >
                    {card.title}
                </Text>
            </View>
            <View
                style={{ flex: TABLE_COLUMNS.list }}
                className="flex-row items-center gap-1.5 pr-2"
            >
                <CategoryGlyph category={listCategory} size={11} />
                <Text className="flex-1 text-[12.5px] text-muted" numberOfLines={1}>
                    {listName}
                </Text>
            </View>
            <View style={{ width: TABLE_COLUMNS.assignees }}>
                <Assignees assignees={card.assignees} />
            </View>
            <View style={{ flex: TABLE_COLUMNS.labels }} className="pr-2">
                <Labels card={card} />
            </View>
            <View style={{ width: TABLE_COLUMNS.start }}>
                <StartCell start={card.start} />
            </View>
            <View style={{ width: TABLE_COLUMNS.due }}>
                <DueCell due={card.due} dueHasTime={card.dueHasTime} />
            </View>
            <View
                style={{ width: TABLE_COLUMNS.priority }}
                className="flex-row items-center gap-1.5"
            >
                <PriorityGlyph priority={card.priority} size={12} />
                {card.priority !== 'none' ? (
                    <Text className="text-[12.5px] text-muted">{priorityLabel(card.priority)}</Text>
                ) : null}
            </View>
            <View style={{ width: TABLE_COLUMNS.estimate }}>
                <EstimateCell estimate={card.estimate} />
            </View>
        </Pressable>
    )
}

/** Zero-size marker the keyboard e2e asserts on — the same one BoardCard mounts. */
function SelectedMarker({ isSelected, cardId }: { isSelected: boolean; cardId: string }) {
    if (!isSelected) return null
    return <View testID={`boards-selected-${cardId}`} />
}

function FocusMarker({ isFocused, cardId }: { isFocused: boolean; cardId: string }) {
    if (!isFocused) return null
    return <View testID={`boards-focused-${cardId}`} />
}

function Meta({ text }: { text: string }) {
    if (!text) return null
    return (
        <Text className="text-[11.5px] font-medium tracking-wide text-muted" numberOfLines={1}>
            {text}
        </Text>
    )
}

function BoardTile({ board }: { board?: CardRowBoard }) {
    if (!board) return null
    return (
        <View className="flex-row items-center gap-1.5">
            <View className="w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: board.color }} />
            <Text className="text-[11.5px] font-medium text-muted" numberOfLines={1}>
                {board.name}
            </Text>
        </View>
    )
}

function Assignees({ assignees }: { assignees: BoardMember[] }) {
    if (assignees.length === 0) return null
    return (
        <View className="flex-row">
            {assignees.slice(0, 3).map((member, index) => (
                <View
                    key={member.id}
                    className={`rounded-full border-2 border-background ${index > 0 ? '-ml-1.5' : ''}`}
                >
                    <NameAvatar
                        firstName={member.firstName}
                        lastName={member.lastName}
                        size={20}
                        colorKey={member.id}
                    />
                </View>
            ))}
            {assignees.length > 3 ? (
                <Text className="text-[11px] font-medium text-muted ml-1">
                    +{assignees.length - 3}
                </Text>
            ) : null}
        </View>
    )
}

function Labels({ card }: { card: BoardCardView }) {
    if (card.labels.length === 0) return null
    return (
        <View className="flex-row flex-wrap items-center gap-1">
            {card.labels.slice(0, 3).map(label => (
                <LabelBadge key={label.id} name={label.name} color={label.color} />
            ))}
            {card.labels.length > 3 ? (
                <Text className="text-[11px] font-medium text-muted">
                    +{card.labels.length - 3}
                </Text>
            ) : null}
        </View>
    )
}

function EstimateCell({ estimate }: { estimate?: number }) {
    const mutedColor = useThemeColor('muted')
    if (estimate === undefined) return null
    return (
        <View className="flex-row items-center gap-1">
            <Gauge size={11} color={mutedColor} strokeWidth={2.2} />
            <Text className="text-[12px] font-medium text-muted">{formatEstimate(estimate)}</Text>
        </View>
    )
}

function StartCell({ start }: { start?: Date }) {
    const mutedColor = useThemeColor('muted')
    if (!start) return null
    return (
        <View className="flex-row items-center gap-1">
            <CalendarDays size={11} color={mutedColor} strokeWidth={2.2} />
            <Text className="text-[12px] font-medium" style={{ color: mutedColor }}>
                {formatDueDate(start)}
            </Text>
        </View>
    )
}

/**
 * The due date, coloured by state. The stacked row passes `start` too, so a
 * phone reads "Sep 3 → Sep 10" in one cell; the table has a Start column.
 */
function DueCell({ start, due, dueHasTime }: { start?: Date; due?: Date; dueHasTime: boolean }) {
    const warningColor = useThemeColor('warning')
    const dangerColor = useThemeColor('danger')
    const mutedColor = useThemeColor('muted')
    if (!due && !start) return null
    const state = due ? dueStateFor(due, undefined, dueHasTime) : 'upcoming'
    const isOverdue = state === 'overdue'
    const Icon = isOverdue ? Clock : CalendarDays
    const color = isOverdue ? dangerColor : state === 'soon' ? warningColor : mutedColor
    return (
        <View className="flex-row items-center gap-1">
            <Icon size={11} color={color} strokeWidth={2.2} />
            <Text className="text-[12px] font-medium" style={{ color }}>
                {formatSchedule(start, due, dueHasTime)}
            </Text>
        </View>
    )
}
