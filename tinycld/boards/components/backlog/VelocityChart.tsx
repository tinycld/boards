import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useMemo, useState } from 'react'
import { type LayoutChangeEvent, Text, View } from 'react-native'
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg'
import { sprintLabel } from '../../lib/sprint'
import { buildVelocity, type VelocityData } from '../../lib/sprint-chart'
import type { BoardSprint } from '../../types'

const HEIGHT = 130
const PAD = { top: 10, right: 8, bottom: 22, left: 30 }

/**
 * Velocity: for each of the last six completed sprints, what it committed
 * to beside what it finished, with the average finished as a line — the
 * number a team plans the next sprint against. Drawn from the stamps a
 * completion writes (server/sprint_lifecycle.go), never from the live
 * rollup, which drops as rolled cards leave.
 */
export function VelocityChart({ sprints }: { sprints: BoardSprint[] }) {
    const [width, setWidth] = useState(0)
    const velocity = useMemo(() => buildVelocity(sprints), [sprints])
    const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)
    if (velocity.bars.length === 0) return null
    return (
        <View className="gap-1 pb-2" onLayout={onLayout} testID="boards-velocity-chart">
            <Text className="text-[11.5px] text-muted">
                Velocity · {formatAverage(velocity.average)} {unitLabel(velocity)} finished per
                sprint on average
            </Text>
            <Bars velocity={velocity} width={width} />
        </View>
    )
}

function unitLabel(velocity: VelocityData): string {
    if (velocity.unit === 'pts') return 'points'
    return velocity.average === 1 ? 'card' : 'cards'
}

function formatAverage(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function Bars({ velocity, width }: { velocity: VelocityData; width: number }) {
    const committedColor = useThemeColor('border')
    const completedColor = useThemeColor('success')
    const mutedColor = useThemeColor('muted')
    const primaryColor = useThemeColor('primary')
    if (width === 0) return <View style={{ height: HEIGHT }} />
    const max = Math.max(1, ...velocity.bars.map(bar => Math.max(bar.committed, bar.completed)))
    const innerWidth = width - PAD.left - PAD.right
    const innerHeight = HEIGHT - PAD.top - PAD.bottom
    const slot = innerWidth / velocity.bars.length
    const barWidth = Math.min(22, slot * 0.3)
    const y = (value: number) => PAD.top + innerHeight - (value / max) * innerHeight
    const baseline = y(0)
    return (
        <Svg width={width} height={HEIGHT}>
            <Line
                x1={PAD.left}
                y1={baseline}
                x2={width - PAD.right}
                y2={baseline}
                stroke={committedColor}
                strokeWidth={1}
            />
            <SvgText
                x={PAD.left - 4}
                y={y(max) + 4}
                fontSize={10}
                fill={mutedColor}
                textAnchor="end"
            >
                {String(max)}
            </SvgText>
            {velocity.bars.map((bar, index) => {
                const center = PAD.left + slot * index + slot / 2
                return (
                    <VelocityBarPair
                        key={bar.sprint.id}
                        label={sprintLabel(bar.sprint)}
                        center={center}
                        barWidth={barWidth}
                        committedTop={y(bar.committed)}
                        completedTop={y(bar.completed)}
                        baseline={baseline}
                        colors={{
                            committed: committedColor,
                            completed: completedColor,
                            label: mutedColor,
                        }}
                    />
                )
            })}
            <Line
                x1={PAD.left}
                y1={y(velocity.average)}
                x2={width - PAD.right}
                y2={y(velocity.average)}
                stroke={primaryColor}
                strokeWidth={1}
                strokeDasharray="4 3"
            />
        </Svg>
    )
}

function VelocityBarPair({
    label,
    center,
    barWidth,
    committedTop,
    completedTop,
    baseline,
    colors,
}: {
    label: string
    center: number
    barWidth: number
    committedTop: number
    completedTop: number
    baseline: number
    colors: { committed: string; completed: string; label: string }
}) {
    return (
        <>
            <Rect
                x={center - barWidth - 1}
                y={committedTop}
                width={barWidth}
                height={baseline - committedTop}
                fill={colors.committed}
            />
            <Rect
                x={center + 1}
                y={completedTop}
                width={barWidth}
                height={baseline - completedTop}
                fill={colors.completed}
            />
            <SvgText
                x={center}
                y={HEIGHT - 6}
                fontSize={10}
                fill={colors.label}
                textAnchor="middle"
            >
                {label}
            </SvgText>
        </>
    )
}
