import { fromDateString } from '@tinycld/core/lib/dates'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useMemo, useState } from 'react'
import { type LayoutChangeEvent, Pressable, Text, View } from 'react-native'
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg'
import { useSprintSnapshots } from '../../hooks/useSprintSnapshots'
import { type BurndownPoint, buildSprintChart, type SprintChartData } from '../../lib/sprint-chart'
import type { BoardSprint } from '../../types'

type ChartKind = 'burndown' | 'progress'

const HEIGHT = 150
const PAD = { top: 10, right: 12, bottom: 22, left: 30 }

/**
 * A sprint's report, drawn from its daily snapshots: the burndown (what was
 * left each day against the straight line to zero — Jira's) or the progress
 * graph (scope against done over the days — Linear's). Plain SVG so web
 * and native draw the same picture; the arithmetic is lib/sprint-chart.ts.
 */
export function SprintChart({ sprint }: { sprint: BoardSprint }) {
    const snapshots = useSprintSnapshots(sprint.id)
    const [kind, setKind] = useState<ChartKind>('burndown')
    const [width, setWidth] = useState(0)
    const chart = useMemo(() => buildSprintChart(sprint, snapshots), [sprint, snapshots])
    const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)

    return (
        <View
            className="gap-2 pt-2"
            onLayout={onLayout}
            testID={`boards-sprint-report-${sprint.id}`}
        >
            <KindToggle kind={kind} onChange={setKind} />
            <ChartBody chart={chart} kind={kind} width={width} />
        </View>
    )
}

function KindToggle({ kind, onChange }: { kind: ChartKind; onChange: (kind: ChartKind) => void }) {
    return (
        <View className="flex-row gap-1">
            <KindButton
                label="Burndown"
                isActive={kind === 'burndown'}
                onPress={() => onChange('burndown')}
            />
            <KindButton
                label="Progress"
                isActive={kind === 'progress'}
                onPress={() => onChange('progress')}
            />
        </View>
    )
}

function KindButton({
    label,
    isActive,
    onPress,
}: {
    label: string
    isActive: boolean
    onPress: () => void
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            onPress={onPress}
            className={`rounded-full px-2.5 py-[3px] border ${isActive ? 'border-primary bg-primary/10' : 'border-border'}`}
        >
            <Text
                className={`text-[11.5px] font-medium ${isActive ? 'text-primary' : 'text-muted'}`}
            >
                {label}
            </Text>
        </Pressable>
    )
}

function ChartBody({
    chart,
    kind,
    width,
}: {
    chart: SprintChartData | null
    kind: ChartKind
    width: number
}) {
    const colors = {
        line: useThemeColor('primary'),
        done: useThemeColor('success'),
        muted: useThemeColor('muted'),
        border: useThemeColor('border'),
    }
    if (!chart) {
        return (
            <Text className="text-[12px] text-muted">
                Dates the sprint first — a chart needs days to draw.
            </Text>
        )
    }
    if (width === 0) return <View style={{ height: HEIGHT }} />
    const hasData = chart.points.some(point => point.remaining !== null)
    if (!hasData) {
        return (
            <Text className="text-[12px] text-muted">
                No snapshots yet — the first is taken when the sprint starts.
            </Text>
        )
    }
    const scale = makeScale(chart, width)
    return (
        <Svg width={width} height={HEIGHT}>
            <Axes chart={chart} scale={scale} colors={colors} />
            <Series chart={chart} kind={kind} scale={scale} colors={colors} />
        </Svg>
    )
}

interface Scale {
    x: (index: number) => number
    y: (value: number) => number
    max: number
}

function makeScale(chart: SprintChartData, width: number): Scale {
    const last = Math.max(1, chart.points.length - 1)
    const max = Math.max(1, chart.max)
    const innerWidth = width - PAD.left - PAD.right
    const innerHeight = HEIGHT - PAD.top - PAD.bottom
    return {
        x: index => PAD.left + (index / last) * innerWidth,
        y: value => PAD.top + innerHeight - (value / max) * innerHeight,
        max,
    }
}

interface ChartColors {
    line: string
    done: string
    muted: string
    border: string
}

function Axes({
    chart,
    scale,
    colors,
}: {
    chart: SprintChartData
    scale: Scale
    colors: ChartColors
}) {
    const first = chart.points[0]
    const last = chart.points[chart.points.length - 1]
    const baseline = scale.y(0)
    return (
        <>
            <Line
                x1={PAD.left}
                y1={baseline}
                x2={scale.x(chart.points.length - 1)}
                y2={baseline}
                stroke={colors.border}
                strokeWidth={1}
            />
            <Line
                x1={PAD.left}
                y1={scale.y(scale.max)}
                x2={PAD.left}
                y2={baseline}
                stroke={colors.border}
                strokeWidth={1}
            />
            <SvgText
                x={PAD.left - 4}
                y={scale.y(scale.max) + 4}
                fontSize={10}
                fill={colors.muted}
                textAnchor="end"
            >
                {String(scale.max)}
            </SvgText>
            <SvgText
                x={PAD.left - 4}
                y={baseline + 4}
                fontSize={10}
                fill={colors.muted}
                textAnchor="end"
            >
                0
            </SvgText>
            <SvgText
                x={PAD.left}
                y={HEIGHT - 6}
                fontSize={10}
                fill={colors.muted}
                textAnchor="start"
            >
                {dayLabel(first?.day)}
            </SvgText>
            <SvgText
                x={scale.x(chart.points.length - 1)}
                y={HEIGHT - 6}
                fontSize={10}
                fill={colors.muted}
                textAnchor="end"
            >
                {dayLabel(last?.day)}
            </SvgText>
        </>
    )
}

function Series({
    chart,
    kind,
    scale,
    colors,
}: {
    chart: SprintChartData
    kind: ChartKind
    scale: Scale
    colors: ChartColors
}) {
    if (kind === 'burndown') {
        const idealPath = pathOf(chart.points, point => point.ideal, scale)
        const remainingPath = pathOf(chart.points, point => point.remaining, scale)
        return (
            <>
                <Path
                    d={idealPath}
                    stroke={colors.muted}
                    strokeWidth={1}
                    strokeDasharray="4 3"
                    fill="none"
                />
                <Path d={remainingPath} stroke={colors.line} strokeWidth={2} fill="none" />
                <Dots
                    points={chart.points}
                    value={point => point.remaining}
                    scale={scale}
                    color={colors.line}
                />
            </>
        )
    }
    const scopePath = pathOf(chart.points, point => point.scope, scale)
    const donePath = pathOf(chart.points, point => point.done, scale)
    return (
        <>
            <Path d={scopePath} stroke={colors.muted} strokeWidth={1.5} fill="none" />
            <Path d={donePath} stroke={colors.done} strokeWidth={2} fill="none" />
            <Dots
                points={chart.points}
                value={point => point.done}
                scale={scale}
                color={colors.done}
            />
        </>
    )
}

function Dots({
    points,
    value,
    scale,
    color,
}: {
    points: BurndownPoint[]
    value: (point: BurndownPoint) => number | null
    scale: Scale
    color: string
}) {
    const dots = points.flatMap((point, index) => {
        const v = value(point)
        return v === null ? [] : [{ key: point.day, cx: scale.x(index), cy: scale.y(v) }]
    })
    return (
        <>
            {dots.map(dot => (
                <Circle key={dot.key} cx={dot.cx} cy={dot.cy} r={2.5} fill={color} />
            ))}
        </>
    )
}

/**
 * An SVG path through the non-null values, lifting the pen over a gap so a
 * missed day shows as a break rather than a straight line across it.
 */
function pathOf(
    points: BurndownPoint[],
    value: (point: BurndownPoint) => number | null,
    scale: Scale
): string {
    let d = ''
    let penDown = false
    points.forEach((point, index) => {
        const v = value(point)
        if (v === null) {
            penDown = false
            return
        }
        d += `${penDown ? 'L' : 'M'}${scale.x(index).toFixed(1)} ${scale.y(v).toFixed(1)} `
        penDown = true
    })
    return d.trim()
}

function dayLabel(day: string | undefined): string {
    const date = day ? fromDateString(day) : null
    return date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
}
