import { Animated, Text, View } from 'react-native'
import type { DayColumn } from '../../lib/timeline'
import { AXIS_HEIGHT, type TimelineMetrics } from './metrics'

interface TimelineAxisProps {
    columns: DayColumn[]
    metrics: TimelineMetrics
    /** The horizontal scroll offset, so the label corner stays pinned. */
    scrollX: Animated.Value
}

/**
 * The day axis: month names over day numbers, weekends tinted, today
 * marked. Sticky at the top of the vertical scroller; its left corner rides
 * the horizontal scroll like every row's label cell does.
 */
export function TimelineAxis({ columns, metrics, scrollX }: TimelineAxisProps) {
    return (
        <View
            className="flex-row bg-background border-b border-border"
            style={{ height: AXIS_HEIGHT }}
        >
            <Animated.View
                className="bg-background border-r border-border z-10"
                style={{ width: metrics.labelWidth, transform: [{ translateX: scrollX }] }}
            />
            <View className="flex-row">
                {columns.map(column => (
                    <DayCell key={column.date.getTime()} column={column} width={metrics.dayWidth} />
                ))}
            </View>
        </View>
    )
}

function DayCell({ column, width }: { column: DayColumn; width: number }) {
    const tint = column.isWeekend ? 'bg-foreground/[0.03]' : ''
    const dayClass = column.isToday
        ? 'bg-primary text-primary-foreground rounded-full'
        : 'text-muted'
    return (
        <View className={`items-center justify-end pb-1 ${tint}`} style={{ width }}>
            <MonthLabel label={column.monthLabel} />
            <Text
                className={`text-[11px] font-medium w-5 h-5 text-center leading-5 ${dayClass}`}
                testID={column.isToday ? 'boards-timeline-today' : undefined}
            >
                {column.label}
            </Text>
        </View>
    )
}

/** Absolutely positioned so a month name can overflow its first narrow cell. */
function MonthLabel({ label }: { label?: string }) {
    if (!label) return null
    return (
        <Text
            className="absolute top-1 left-1 text-[10.5px] font-semibold text-foreground"
            numberOfLines={1}
        >
            {label}
        </Text>
    )
}
