import { EmptyState } from '@tinycld/core/components/EmptyState'
import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { useCallback, useMemo, useRef } from 'react'
import { Animated, ScrollView } from 'react-native'
import { useBoardShortcuts } from '../../hooks/useBoardShortcuts'
import { useProjectRole } from '../../hooks/useProjectRole'
import { buildTimeline, dayColumns, type TimelineGroup } from '../../lib/timeline'
import { selectBoardSort, useBoardsUIStore } from '../../stores/boards-ui-store'
import type { BoardProject } from '../../types'
import { DESKTOP_METRICS, MOBILE_METRICS } from './metrics'
import { TimelineAxis } from './TimelineAxis'
import { type RowChromeProps, TimelineGroupHeader, TimelineRow } from './TimelineRow'

/**
 * The board as a timeline: a day axis across the top, one row per card with a
 * start or due date, grouped by list. The same filtered, sorted tree the
 * canvas renders — switching views changes the shape, never the set. Rows
 * open the peek; j/k walk them in drawn order.
 *
 * Layout: an outer HORIZONTAL scroller (the BoardCanvas shape) holding a
 * vertical one, with the axis sticky at its top. Each row's label cell is
 * translated by the horizontal offset so it stays pinned at the left without
 * a second scroller to keep in step. Everything is a fixed height, so no
 * row is ever measured.
 *
 * Read-only in this version: there is no drag to reschedule. Dates are
 * changed on the card, and the row follows.
 */
export function BoardTimeline({ project }: { project: BoardProject }) {
    const { canEdit } = useProjectRole(project.id)
    const sort = useBoardsUIStore(s => selectBoardSort(s, project.id))
    const openCard = useBoardsUIStore(s => s.openCard)
    const metrics = useBreakpoint() === 'mobile' ? MOBILE_METRICS : DESKTOP_METRICS
    const scrollX = useRef(new Animated.Value(0)).current

    const timeline = useMemo(() => buildTimeline(project, sort, new Date()), [project, sort])
    const columns = useMemo(() => dayColumns(timeline.range), [timeline.range])
    useBoardShortcuts(project, canEdit, { visibleOrder: timeline.visibleOrder })

    // Opens with today a couple of days in from the pinned label column — a
    // ref callback rather than an effect (calendar's TimeGrid shape): it fires
    // once, when the scroller mounts, which is the only time it should.
    const { todayCol } = timeline
    const scrollToToday = useCallback(
        (node: ScrollView | null) => {
            if (!node) return
            node.scrollTo({ x: Math.max(0, (todayCol - 2) * metrics.dayWidth), animated: false })
        },
        [todayCol, metrics.dayWidth]
    )

    if (timeline.groups.length === 0) {
        return <EmptyState message="No cards have a start or due date" />
    }

    const rowChrome = { metrics, scrollX, days: timeline.range.days, todayCol }
    return (
        <Animated.ScrollView
            ref={scrollToToday}
            horizontal
            testID="boards-timeline"
            className="flex-1"
            scrollEventThrottle={16}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
                useNativeDriver: false,
            })}
            contentContainerStyle={{ minHeight: '100%' }}
        >
            <ScrollView nestedScrollEnabled stickyHeaderIndices={[0]}>
                <TimelineAxis columns={columns} metrics={metrics} scrollX={scrollX} />
                {timeline.groups.map(group => (
                    <GroupRows
                        key={group.list.id}
                        group={group}
                        chrome={rowChrome}
                        onOpen={openCard}
                    />
                ))}
            </ScrollView>
        </Animated.ScrollView>
    )
}

function GroupRows({
    group,
    chrome,
    onOpen,
}: {
    group: TimelineGroup
    chrome: RowChromeProps
    onOpen: (cardId: string) => void
}) {
    return (
        <>
            <TimelineGroupHeader list={group.list} {...chrome} />
            {group.rows.map(row => (
                <TimelineRow
                    key={row.card.id}
                    row={row}
                    {...chrome}
                    onPress={() => onOpen(row.card.id)}
                />
            ))}
        </>
    )
}
