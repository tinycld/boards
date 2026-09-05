// Sprint helpers shared by the board tree, the history feed and the CLI's
// display conventions. Pure, so they test without React.

import type { BoardSprint, BoardsProjects } from '../types'

/** The default sprint length, used when a board's setting is 0 (unset). */
export const DEFAULT_SPRINT_LENGTH_DAYS = 14

/**
 * "Sprint 4", or the name when the team gave one. The number is the stable
 * handle — it is what history rows and the CLI address — so a renamed
 * sprint still reads as the same sprint everywhere.
 */
export function sprintLabel(sprint: Pick<BoardSprint, 'number' | 'name'>): string {
    return sprint.name || `Sprint ${sprint.number}`
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
