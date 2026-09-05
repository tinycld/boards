import { eq } from '@tanstack/db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useMemo } from 'react'
import { type SprintSnapshot, toSprintSnapshot } from '../lib/sprint-chart'
import { useBoardLiveQuery } from './useBoardLiveQuery'

/**
 * One sprint's daily snapshots, oldest first. The collection is on-demand
 * (collections.ts): a chart is opened for one sprint at a time, and a
 * board's history of snapshots is not something every screen should carry.
 */
export function useSprintSnapshots(sprintId: string): SprintSnapshot[] {
    const [snapshotsCollection] = useStore('boards_sprint_snapshots')
    const { data } = useBoardLiveQuery(
        query =>
            query
                .from({ row: snapshotsCollection })
                .where(({ row }) => eq(row.sprint, sprintId))
                .orderBy(({ row }) => row.day, 'asc'),
        [sprintId]
    )
    return useMemo(() => (data ?? []).map(toSprintSnapshot), [data])
}
