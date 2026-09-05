import { and, eq, gte, lte } from '@tanstack/db'
import { addDays, toDateString } from '@tinycld/core/lib/dates'
import type { EventSourceItem, EventSourceRange } from '@tinycld/core/lib/event-sources/types'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import type { Href } from 'expo-router'
import { useMemo } from 'react'
import { parseDayValue } from './lib/due-time'
import { sprintLabel } from './lib/sprint'

// Calendar event source: sprint starts and ends, contributed via the
// manifest's second `eventSources` entry. Its own source (with its own
// sidebar toggle) rather than a widening of `boards-due`: a planner wants
// deadlines and sprint boundaries switchable separately.

interface SprintRow {
    id: string
    number: number
    name: string
    start: string
    end: string
    boardName: string
}

type HrefBuilder = (path: string, extra?: Record<string, string>) => Href

/**
 * Two all-day items per dated sprint — "Sprint 3 starts" on its first day and
 * "Sprint 3 ends" on its last — rather than one span. The host's contract is
 * a start and an end; a two-week all-day span would sit across every day
 * between, which is exactly the noise a boundary marker avoids. Undated halves
 * are skipped, not guessed.
 */
export function buildSprintItems(
    rows: readonly SprintRow[],
    orgHref: HrefBuilder
): EventSourceItem[] {
    const items: EventSourceItem[] = []
    for (const row of rows) {
        const label = `${sprintLabel(row)} · ${row.boardName}`
        const href = orgHref('boards')
        const start = parseDayValue(row.start)
        const end = parseDayValue(row.end)
        if (start) items.push(allDay(`${row.id}:start`, `${label} starts`, start, href))
        if (end) items.push(allDay(`${row.id}:end`, `${label} ends`, end, href))
    }
    return items
}

function allDay(id: string, title: string, day: Date, href: Href): EventSourceItem {
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999)
    return { id, title, start: day.toISOString(), end: end.toISOString(), allDay: true, href }
}

export function useEventSource({ start, end }: EventSourceRange): {
    items: EventSourceItem[]
    isLoading: boolean
} {
    const orgHref = useOrgHref()
    const [sprintsCollection, projectsCollection] = useStore('boards_sprints', 'boards_projects')

    // Day-precision local bounds compared as strings, the boards-due source's
    // reasoning. A sprint is wanted when EITHER boundary falls in the range.
    const startDay = toDateString(addDays(start, -1))
    const endDay = toDateString(addDays(end, 1))

    const { data: rows, isLoading } = useOrgLiveQuery(
        query =>
            query
                .from({ sprint: sprintsCollection })
                .innerJoin({ project: projectsCollection }, ({ sprint, project }) =>
                    eq(sprint.project, project.id)
                )
                .where(({ sprint, project }) =>
                    and(
                        eq(project.archived, false),
                        eq(project.sprints_enabled, true),
                        // Dated on at least one end inside the window.
                        gte(sprint.end, startDay),
                        lte(sprint.start, endDay)
                    )
                )
                .select(({ sprint, project }) => ({
                    id: sprint.id,
                    number: sprint.number,
                    name: sprint.name,
                    start: sprint.start,
                    end: sprint.end,
                    boardName: project.name,
                })),
        [startDay, endDay]
    )

    const items = useMemo(() => buildSprintItems(rows ?? [], orgHref), [rows, orgHref])
    return { items, isLoading }
}
