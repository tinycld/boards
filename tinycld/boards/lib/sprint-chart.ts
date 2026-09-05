// The two sprint reports, as data: a burndown (what is left each day against
// the straight line to zero) and velocity (what each finished sprint
// committed to against what it finished). Pure, on rows the server wrote,
// so the arithmetic is tested without React and the chart only draws.
//
// Days are calendar dates as `YYYY-MM-DD` text. A snapshot's `day` is the
// server's UTC day (server/sprint_lifecycle.go's utcDay) and a sprint's
// start and end are local days, and the two are matched as TEXT: the day a
// snapshot names is the day it is drawn on, whatever zone read it.

import { addDays, toDateString } from '@tinycld/core/lib/dates'
import type { BoardsSprintSnapshots } from '@tinycld/core/types/pbSchema'
import type { BoardSprint } from '../types'

export type SprintUnit = 'pts' | 'cards'

export interface SprintSnapshot {
    /** `YYYY-MM-DD`. */
    day: string
    scopeCount: number
    scopePoints: number
    doneCount: number
    donePoints: number
}

export function toSprintSnapshot(row: BoardsSprintSnapshots): SprintSnapshot {
    return {
        day: row.day.slice(0, 10),
        scopeCount: row.scope_count,
        scopePoints: row.scope_points,
        doneCount: row.done_count,
        donePoints: row.done_points,
    }
}

export interface BurndownPoint {
    day: string
    /** Scope minus done on that day; null when no snapshot was taken. */
    remaining: number | null
    scope: number | null
    done: number | null
    /** The straight line from the commitment to zero on the last day. */
    ideal: number
}

export interface SprintChartData {
    unit: SprintUnit
    /** The y-axis ceiling: the largest scope seen, or the commitment. */
    max: number
    points: BurndownPoint[]
}

/**
 * Points when anything in the sprint was ever estimated, cards otherwise —
 * the header's rule (lib/sprint.ts's sprintProgress), extended to the
 * snapshots so a sprint whose estimates were all cleared still reads in
 * the unit it was planned in.
 */
export function sprintUnit(
    sprint: Pick<BoardSprint, 'pointsTotal' | 'committedPoints'>,
    snapshots: SprintSnapshot[]
): SprintUnit {
    if (sprint.pointsTotal > 0 || sprint.committedPoints > 0) return 'pts'
    return snapshots.some(s => s.scopePoints > 0) ? 'pts' : 'cards'
}

/**
 * One point per day of the sprint, first to last inclusive. Null where no
 * snapshot exists (a day the sweep missed, or one still to come), so the
 * line breaks rather than inventing a value. Undated sprints have no chart.
 */
export function buildSprintChart(
    sprint: Pick<
        BoardSprint,
        'start' | 'end' | 'pointsTotal' | 'committedPoints' | 'committedCount'
    >,
    snapshots: SprintSnapshot[]
): SprintChartData | null {
    if (!sprint.start || !sprint.end || sprint.end < sprint.start) return null
    const unit = sprintUnit(sprint, snapshots)
    const byDay = new Map<string, SprintSnapshot>()
    for (const snapshot of snapshots) byDay.set(snapshot.day, snapshot)

    const days: string[] = []
    for (let d = sprint.start; d <= sprint.end; d = addDays(d, 1)) days.push(toDateString(d))

    const committed = unit === 'pts' ? sprint.committedPoints : sprint.committedCount
    const firstScope = snapshots.length > 0 ? scopeOf(snapshots[0] as SprintSnapshot, unit) : 0
    const start = committed > 0 ? committed : firstScope
    const last = days.length - 1

    let max = start
    const points = days.map((day, i) => {
        const snapshot = byDay.get(day)
        const scope = snapshot ? scopeOf(snapshot, unit) : null
        const done = snapshot ? doneOf(snapshot, unit) : null
        if (scope !== null && scope > max) max = scope
        return {
            day,
            scope,
            done,
            remaining: scope !== null && done !== null ? scope - done : null,
            ideal: last === 0 ? 0 : start * (1 - i / last),
        }
    })
    return { unit, max, points }
}

function scopeOf(snapshot: SprintSnapshot, unit: SprintUnit): number {
    return unit === 'pts' ? snapshot.scopePoints : snapshot.scopeCount
}

function doneOf(snapshot: SprintSnapshot, unit: SprintUnit): number {
    return unit === 'pts' ? snapshot.donePoints : snapshot.doneCount
}

export interface VelocityBar {
    sprint: BoardSprint
    committed: number
    completed: number
}

export interface VelocityData {
    unit: SprintUnit
    bars: VelocityBar[]
    /** Mean completed across the bars; 0 with none. */
    average: number
}

/** The stamps of the last `limit` completed sprints, oldest first. */
export function buildVelocity(sprints: BoardSprint[], limit = 6): VelocityData {
    const completed = sprints
        .filter(sprint => sprint.state === 'completed')
        .sort((a, b) => a.number - b.number)
        .slice(-limit)
    const unit: SprintUnit = completed.some(s => s.committedPoints > 0 || s.completedPoints > 0)
        ? 'pts'
        : 'cards'
    const bars = completed.map(sprint => ({
        sprint,
        committed: unit === 'pts' ? sprint.committedPoints : sprint.committedCount,
        completed: unit === 'pts' ? sprint.completedPoints : sprint.completedCount,
    }))
    const average =
        bars.length === 0 ? 0 : bars.reduce((sum, bar) => sum + bar.completed, 0) / bars.length
    return { unit, bars, average }
}
