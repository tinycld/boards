// Sprint helpers shared by the board tree, the backlog view, the history feed
// and the pickers. Pure, so they test without React.

import { addDays, startOfDay } from '@tinycld/core/lib/dates'
import type { BoardSprint, BoardsProjects } from '../types'

/** The default sprint length, used when a board's setting is 0 (unset). */
export const DEFAULT_SPRINT_LENGTH_DAYS = 14

/**
 * "Sprint 4", or the name when the team gave one. The number is the stable
 * handle — it is what history rows and the CLI address — so a renamed
 * sprint still reads as the same sprint everywhere.
 *
 * A sprint with no number yet is the optimistic beat before the server's
 * allocator answers (sprint_number.go); it reads as "New sprint" rather
 * than "Sprint 0" for that beat.
 */
export function sprintLabel(sprint: Pick<BoardSprint, 'number' | 'name'>): string {
    if (sprint.name) return sprint.name
    return sprint.number > 0 ? `Sprint ${sprint.number}` : 'New sprint'
}

/** A board's sprint length in days, with 0 reading as the default. */
export function sprintLengthDays(project: Pick<BoardsProjects, 'sprint_length_days'>): number {
    return project.sprint_length_days > 0 ? project.sprint_length_days : DEFAULT_SPRINT_LENGTH_DAYS
}

export type SprintRollover = 'next' | 'backlog'

/** Where an auto-completed sprint sends unfinished cards; '' reads as `next`. */
export function normalizeSprintRollover(raw: string): SprintRollover {
    return raw === 'backlog' ? 'backlog' : 'next'
}

/** active first, then planned, then completed — the backlog's reading order. */
export const SPRINT_STATE_ORDER = { active: 0, planned: 1, completed: 2 } as const

/**
 * The backlog's order: active, then planned by rank, then completed by rank.
 * `BoardProject.sprints` is already sorted this way; the comparator is
 * exported for the sort field and for callers holding a subset.
 */
export function compareSprints(a: BoardSprint, b: BoardSprint): number {
    const byState = SPRINT_STATE_ORDER[a.state] - SPRINT_STATE_ORDER[b.state]
    if (byState !== 0) return byState
    return a.position.localeCompare(b.position) || a.id.localeCompare(b.id)
}

export function activeSprint(sprints: BoardSprint[]): BoardSprint | undefined {
    return sprints.find(sprint => sprint.state === 'active')
}

export function plannedSprints(sprints: BoardSprint[]): BoardSprint[] {
    return sprints.filter(sprint => sprint.state === 'planned')
}

export function completedSprints(sprints: BoardSprint[]): BoardSprint[] {
    return sprints.filter(sprint => sprint.state === 'completed')
}

/** The first planned sprint in rank order — what "next sprint" means. */
export function nextPlannedSprint(sprints: BoardSprint[]): BoardSprint | undefined {
    return plannedSprints(sprints)[0]
}

/** A card may join a planned or active sprint; a completed one is closed. */
export function isOpenForFiling(sprint: Pick<BoardSprint, 'state'>): boolean {
    return sprint.state !== 'completed'
}

/**
 * Whole days from `today` to the sprint's end, inclusive of today: a sprint
 * ending today has 1 day left, one that ended yesterday has 0. Undefined for
 * an undated sprint.
 */
export function daysRemaining(
    sprint: Pick<BoardSprint, 'end'>,
    today = new Date()
): number | undefined {
    if (!sprint.end) return undefined
    const from = startOfDay(today).getTime()
    const to = startOfDay(sprint.end).getTime()
    return Math.max(0, Math.round((to - from) / 86_400_000) + 1)
}

export interface SprintProgress {
    done: number
    total: number
    /** Points when the board estimates (any points at all), else cards. */
    unit: 'pts' | 'cards'
    /** 0..1, 0 for an empty sprint. */
    ratio: number
}

/**
 * What the progress bar shows. Points when the sprint carries any, cards
 * otherwise — a board that never estimates still gets a meaningful bar, and
 * one that does never sees its points diluted by unestimated cards (the
 * server sums raw estimates, no floor).
 */
export function sprintProgress(
    sprint: Pick<BoardSprint, 'cardTotal' | 'cardDone' | 'pointsTotal' | 'pointsDone'>
): SprintProgress {
    const usePoints = sprint.pointsTotal > 0
    const done = usePoints ? sprint.pointsDone : sprint.cardDone
    const total = usePoints ? sprint.pointsTotal : sprint.cardTotal
    return { done, total, unit: usePoints ? 'pts' : 'cards', ratio: total > 0 ? done / total : 0 }
}

/**
 * The dates a new sprint is offered: the day after the latest dated sprint
 * ends (or today, when there is none or it already ended), for the board's
 * length. `end` is inclusive, so a 14-day sprint starting Monday ends the
 * Sunday after next.
 */
export function defaultSprintDates(
    sprints: Pick<BoardSprint, 'end' | 'state'>[],
    lengthDays: number,
    today = new Date()
): { start: Date; end: Date } {
    const day = startOfDay(today)
    const latestEnd = sprints
        .filter(sprint => sprint.state !== 'completed' && sprint.end)
        .map(sprint => startOfDay(sprint.end as Date).getTime())
        .reduce((latest, end) => Math.max(latest, end), 0)
    const start = latestEnd >= day.getTime() ? addDays(new Date(latestEnd), 1) : day
    return { start, end: addDays(start, Math.max(1, lengthDays) - 1) }
}

/** "Sep 1 – Sep 14", "from Sep 1", "until Sep 14", or '' when undated. */
export function formatSprintDates(
    sprint: Pick<BoardSprint, 'start' | 'end'>,
    locale?: string
): string {
    const format = (date: Date) =>
        date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
    if (sprint.start && sprint.end) return `${format(sprint.start)} – ${format(sprint.end)}`
    if (sprint.start) return `from ${format(sprint.start)}`
    if (sprint.end) return `until ${format(sprint.end)}`
    return ''
}
