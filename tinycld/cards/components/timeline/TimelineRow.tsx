import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Animated, Pressable, Text, View } from 'react-native'
import type { DueState } from '../../lib/due-state'
import type { TimelineRow as TimelineRowModel } from '../../lib/timeline'
import { useCardsUIStore } from '../../stores/cards-ui-store'
import type { BoardListView } from '../../types'
import { CategoryGlyph } from '../CategoryGlyph'
import { PriorityGlyph } from '../PriorityGlyph'
import type { TimelineMetrics } from './metrics'

/** What every row needs to draw its pinned label and its track. */
export interface RowChromeProps {
    metrics: TimelineMetrics
    scrollX: Animated.Value
    days: number
    todayCol: number
}

interface TrackProps {
    metrics: TimelineMetrics
    days: number
    todayCol: number
    children?: React.ReactNode
}

interface TimelineRowProps extends RowChromeProps {
    row: TimelineRowModel
    onPress: () => void
}

/**
 * One scheduled card: a pinned label cell (key, title) and a track with the
 * bar or marker at its day columns. The label cell rides the horizontal
 * scroll via a transform so the two scrollers never need syncing, and the
 * row's height is fixed so nothing is ever measured.
 */
export function TimelineRow({ row, metrics, scrollX, days, todayCol, onPress }: TimelineRowProps) {
    // Per-row selector, as BoardCard does: only the row whose ring flipped
    // re-renders on an arrow press.
    const isFocused = useCardsUIStore(s => s.focusedCardId === row.card.id)
    const ring = isFocused ? 'bg-foreground/[0.04]' : ''
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={row.card.title}
            testID={`cards-timeline-row-${row.card.id}`}
            onPress={onPress}
            className={`flex-row border-b border-border hover:bg-foreground/[0.03] ${ring}`}
            style={{ height: metrics.rowHeight }}
        >
            <FocusMarker isFocused={isFocused} cardId={row.card.id} />
            <Animated.View
                className="flex-row items-center gap-1.5 px-3 bg-background border-r border-border z-10"
                style={{ width: metrics.labelWidth, transform: [{ translateX: scrollX }] }}
            >
                <PriorityGlyph priority={row.card.priority} size={11} />
                <Text className="text-[11px] font-medium tracking-wide text-muted">
                    {row.card.key}
                </Text>
                <Text className="flex-1 text-[12.5px] text-foreground" numberOfLines={1}>
                    {row.card.title}
                </Text>
            </Animated.View>
            <Track metrics={metrics} days={days} todayCol={todayCol}>
                <Bar row={row} metrics={metrics} />
            </Track>
        </Pressable>
    )
}

/** A list's heading row, spanning the label cell and an empty track. */
export function TimelineGroupHeader({
    list,
    metrics,
    scrollX,
    days,
    todayCol,
}: RowChromeProps & { list: BoardListView }) {
    return (
        <View
            className="flex-row bg-foreground/[0.02] border-b border-border"
            style={{ height: metrics.rowHeight }}
        >
            <Animated.View
                className="flex-row items-center gap-1.5 px-3 bg-background border-r border-border z-10"
                style={{ width: metrics.labelWidth, transform: [{ translateX: scrollX }] }}
            >
                <CategoryGlyph category={list.category} size={11} />
                <Text className="text-[12px] font-semibold text-foreground" numberOfLines={1}>
                    {list.name}
                </Text>
            </Animated.View>
            <Track metrics={metrics} days={days} todayCol={todayCol} />
        </View>
    )
}

/** The day grid a row draws on: weekend-free (the axis tints those), with today's line. */
function Track({ metrics, days, todayCol, children }: TrackProps) {
    const todayColor = useThemeColor('primary')
    return (
        <View style={{ width: days * metrics.dayWidth }}>
            <View
                className="absolute top-0 bottom-0 w-px opacity-60"
                style={{
                    left: todayCol * metrics.dayWidth + metrics.dayWidth / 2,
                    backgroundColor: todayColor,
                }}
            />
            {children}
        </View>
    )
}

function Bar({ row, metrics }: { row: TimelineRowModel; metrics: TimelineMetrics }) {
    const color = useBarColor(row.dueState)
    const inset = 3
    const left = row.startCol * metrics.dayWidth + inset
    const width = (row.endCol - row.startCol + 1) * metrics.dayWidth - inset * 2
    const top = Math.round((metrics.rowHeight - 14) / 2)
    if (row.kind === 'point') {
        const size = 12
        return (
            <View
                testID="cards-timeline-point"
                className="absolute rounded-full"
                style={{
                    left: left + (width - size) / 2,
                    top: top + 1,
                    width: size,
                    height: size,
                    backgroundColor: color,
                }}
            />
        )
    }
    return (
        <View
            testID="cards-timeline-bar"
            className="absolute rounded-md"
            style={{ left, top, width, height: 14, backgroundColor: color, opacity: 0.85 }}
        />
    )
}

function useBarColor(state: DueState | undefined): string {
    const danger = useThemeColor('danger')
    const warning = useThemeColor('warning')
    const muted = useThemeColor('muted')
    const primary = useThemeColor('primary')
    switch (state) {
        case 'overdue':
            return danger
        case 'soon':
            return warning
        case 'upcoming':
            return primary
        default:
            return muted
    }
}

/** Zero-size marker the keyboard e2e asserts on — the same one BoardCard mounts. */
function FocusMarker({ isFocused, cardId }: { isFocused: boolean; cardId: string }) {
    if (!isFocused) return null
    return <View testID={`cards-focused-${cardId}`} />
}
