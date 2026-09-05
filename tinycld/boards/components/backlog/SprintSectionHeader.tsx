import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ChartLine, ChevronDown, ChevronRight, CircleDot } from 'lucide-react-native'
import { type ReactNode, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { BacklogSection } from '../../lib/backlog'
import { daysRemaining, formatSprintDates, sprintLabel, sprintProgress } from '../../lib/sprint'
import type { BoardSprint } from '../../types'
import { SprintChart } from './SprintChart'

interface SprintSectionHeaderProps {
    section: BacklogSection
    isCollapsed: boolean
    onToggleCollapsed: () => void
    /** The view's own buttons for this section — plan, edit, start, complete. */
    actions?: ReactNode
}

/**
 * The bar above a section's rows: what the sprint is, when it runs, how far
 * along it is, and the view's actions for it. Pressing the title collapses
 * the section — a planned sprint someone is not looking at should fold away
 * the way a column does.
 */
export function SprintSectionHeader({
    section,
    isCollapsed,
    onToggleCollapsed,
    actions,
}: SprintSectionHeaderProps) {
    const mutedColor = useThemeColor('muted')
    const Chevron = isCollapsed ? ChevronRight : ChevronDown
    const title = section.sprint ? sprintLabel(section.sprint) : 'Backlog'
    // The report folds under the header; a planned sprint has nothing to
    // report yet, so it is offered only once the sprint has started.
    const [isChartOpen, setIsChartOpen] = useState(false)
    const hasChart = section.sprint !== null && section.sprint.state !== 'planned'

    return (
        <View className="px-3 py-2 border-b border-border bg-foreground/[0.02]">
            <View className="flex-row items-center gap-2">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${isCollapsed ? 'Expand' : 'Collapse'} ${title}`}
                    accessibilityState={{ expanded: !isCollapsed }}
                    onPress={onToggleCollapsed}
                    className="flex-row items-center gap-1.5 shrink"
                >
                    <Chevron size={14} color={mutedColor} strokeWidth={2.2} />
                    <ActiveGlyph sprint={section.sprint} />
                    <Text
                        testID={`boards-section-title-${section.key}`}
                        className="text-[13.5px] font-semibold text-foreground"
                        numberOfLines={1}
                    >
                        {title}
                    </Text>
                </Pressable>
                <StateBadge sprint={section.sprint} />
                <Text className="text-[12px] text-muted">{countLabel(section)}</Text>
                <View className="flex-1" />
                {actions}
                <ChartToggle
                    isVisible={hasChart}
                    isOpen={isChartOpen}
                    sprint={section.sprint}
                    onPress={() => setIsChartOpen(open => !open)}
                />
            </View>
            <SprintSubtitle sprint={section.sprint} />
            <SprintChartPanel sprint={section.sprint} isVisible={hasChart && isChartOpen} />
        </View>
    )
}

function ChartToggle({
    isVisible,
    isOpen,
    sprint,
    onPress,
}: {
    isVisible: boolean
    isOpen: boolean
    sprint: BoardSprint | null
    onPress: () => void
}) {
    const mutedColor = useThemeColor('muted')
    const primaryColor = useThemeColor('primary')
    if (!isVisible || !sprint) return null
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${isOpen ? 'Hide' : 'Show'} the report for ${sprintLabel(sprint)}`}
            accessibilityState={{ expanded: isOpen }}
            testID={`boards-sprint-chart-toggle-${sprint.number}`}
            onPress={onPress}
            className="rounded-md p-1 hover:bg-foreground/[0.06]"
        >
            <ChartLine size={14} color={isOpen ? primaryColor : mutedColor} strokeWidth={2.2} />
        </Pressable>
    )
}

function SprintChartPanel({
    sprint,
    isVisible,
}: {
    sprint: BoardSprint | null
    isVisible: boolean
}) {
    if (!isVisible || !sprint) return null
    return <SprintChart sprint={sprint} />
}

function countLabel(section: BacklogSection): string {
    const { count, points } = section.totals
    const cards = `${count} ${count === 1 ? 'card' : 'cards'}`
    return points > 0 ? `${cards} · ${points} pts` : cards
}

function ActiveGlyph({ sprint }: { sprint: BoardSprint | null }) {
    const successColor = useThemeColor('success')
    if (sprint?.state !== 'active') return null
    return <CircleDot size={12} color={successColor} strokeWidth={2.4} />
}

function StateBadge({ sprint }: { sprint: BoardSprint | null }) {
    if (!sprint) return null
    const label =
        sprint.state === 'active'
            ? 'Active'
            : sprint.state === 'completed'
              ? 'Completed'
              : 'Planned'
    return (
        <View className="bg-foreground/[0.06] rounded-full px-2 py-0.5">
            <Text className="text-[10.5px] font-semibold text-muted">{label}</Text>
        </View>
    )
}

/** Dates, goal and — for an active sprint — the progress bar with days left. */
function SprintSubtitle({ sprint }: { sprint: BoardSprint | null }) {
    if (!sprint) return null
    const dates = formatSprintDates(sprint)
    const parts = [dates, sprint.goal].filter(Boolean)
    return (
        <View className="gap-1 mt-1">
            {parts.length > 0 ? (
                <Text className="text-[12px] text-muted" numberOfLines={2}>
                    {parts.join(' · ')}
                </Text>
            ) : null}
            <SprintProgressBar sprint={sprint} isVisible={sprint.state !== 'planned'} />
        </View>
    )
}

/**
 * "12 / 30 pts · 6 days left" over a thin bar. Points when the board
 * estimates, cards otherwise (lib/sprint.ts). Hidden for a planned sprint,
 * whose progress is not yet a thing.
 */
export function SprintProgressBar({
    sprint,
    isVisible,
}: {
    sprint: BoardSprint
    isVisible: boolean
}) {
    const successColor = useThemeColor('success')
    if (!isVisible) return null
    const progress = sprintProgress(sprint)
    const left = sprint.state === 'active' ? daysRemaining(sprint) : undefined
    const summary = [
        `${progress.done} / ${progress.total} ${progress.unit}`,
        left === undefined
            ? ''
            : left === 0
              ? 'ends today'
              : `${left} ${left === 1 ? 'day' : 'days'} left`,
    ]
        .filter(Boolean)
        .join(' · ')
    return (
        <View className="gap-1" testID={`boards-sprint-progress-${sprint.id}`}>
            <View className="h-1 rounded-full bg-foreground/[0.08] overflow-hidden">
                <View
                    className="h-1 rounded-full"
                    style={{
                        width: `${Math.round(progress.ratio * 100)}%`,
                        backgroundColor: successColor,
                    }}
                />
            </View>
            <Text className="text-[11.5px] text-muted">{summary}</Text>
        </View>
    )
}
