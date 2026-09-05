import { Animated, Text, View } from 'react-native'
import { sprintLabel } from '../../lib/sprint'
import type { SprintSpan } from '../../lib/timeline'
import type { TimelineMetrics } from './metrics'

/** Height of the band strip under the axis; 0 when there is nothing to draw. */
export const BANDS_HEIGHT = 18

/**
 * Sprint bands over the day axis: one tinted strip per dated sprint, the
 * active one stronger. A row of its own under the sticky axis rather than
 * inside it, so the axis height stays what every row's maths assumes. The
 * label corner rides the horizontal scroll like the axis's does.
 */
export function SprintBands({
    spans,
    metrics,
    scrollX,
}: {
    spans: SprintSpan[]
    metrics: TimelineMetrics
    scrollX: Animated.Value
}) {
    if (spans.length === 0) return null
    return (
        <View className="flex-row border-b border-border" style={{ height: BANDS_HEIGHT }}>
            <Animated.View
                className="bg-background border-r border-border z-10"
                style={{ width: metrics.labelWidth, transform: [{ translateX: scrollX }] }}
            />
            <View style={{ flex: 1 }}>
                {spans.map(span => (
                    <Band key={span.sprint.id} span={span} dayWidth={metrics.dayWidth} />
                ))}
            </View>
        </View>
    )
}

function Band({ span, dayWidth }: { span: SprintSpan; dayWidth: number }) {
    const isActive = span.sprint.state === 'active'
    return (
        <View
            testID={`boards-timeline-sprint-${span.sprint.number}`}
            className={`absolute top-[2px] h-[14px] rounded-sm justify-center px-1.5 ${
                isActive ? 'bg-primary/25' : 'bg-foreground/[0.08]'
            }`}
            style={{
                left: span.startCol * dayWidth,
                width: (span.endCol - span.startCol + 1) * dayWidth,
            }}
        >
            <Text className="text-[10px] font-semibold text-foreground" numberOfLines={1}>
                {sprintLabel(span.sprint)}
            </Text>
        </View>
    )
}
