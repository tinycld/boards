import { and, eq, gte, lt } from '@tanstack/db'
import { addDays, toDateString } from '@tinycld/core/lib/dates'
import type { EventSourceItem, EventSourceRange } from '@tinycld/core/lib/event-sources/types'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import type { Href } from 'expo-router'
import { useMemo } from 'react'
import { parseDueValue } from './lib/due-time'

// Calendar event source: cards with due dates, contributed via the manifest's
// `eventSources` entry. The calendar package mounts this hook through core's
// event-source registry — cards never imports calendar (lean shell), so the
// shared contract lives in @tinycld/core/lib/event-sources.

interface DueCardRow {
    id: string
    title: string
    due: string
    due_has_time: boolean
}

/** A timed deadline lands on the grid as this long a block. */
const TIMED_ITEM_MS = 30 * 60 * 1000

type HrefBuilder = (path: string, extra?: Record<string, string>) => Href

/**
 * Pure mapping from due-card rows to source items, exported for tests.
 *
 * A day-only due date is an all-day item spanning its LOCAL day (the
 * lib/due-time.ts rebuild keeps "due tomorrow" on tomorrow's cell in every
 * timezone); a timed one is a short block at its instant, which the host lays
 * out on the time grid through the same `allDay: false` contract as a real
 * event.
 */
export function buildDueItems(
    rows: readonly DueCardRow[],
    orgHref: HrefBuilder
): EventSourceItem[] {
    const items: EventSourceItem[] = []
    for (const row of rows) {
        const due = parseDueValue(row.due, row.due_has_time)
        if (!due) continue
        const end = row.due_has_time
            ? new Date(due.getTime() + TIMED_ITEM_MS)
            : new Date(due.getFullYear(), due.getMonth(), due.getDate(), 23, 59, 59, 999)
        items.push({
            id: row.id,
            title: row.title,
            start: due.toISOString(),
            end: end.toISOString(),
            allDay: !row.due_has_time,
            href: orgHref('cards/[cardId]', { cardId: row.id }),
        })
    }
    return items
}

export function useEventSource({ start, end }: EventSourceRange): {
    items: EventSourceItem[]
    isLoading: boolean
} {
    const orgHref = useOrgHref()
    const [cardsCollection, projectsCollection] = useStore('cards_cards', 'cards_projects')

    // Day-precision LOCAL bounds, compared as strings: 'YYYY-MM-DD' prefixes
    // order correctly against both the bare day the picker writes and the
    // 'YYYY-MM-DD 00:00:00.000Z' PocketBase normalizes it to, and the
    // half-open [startDay, dayAfterEnd) window also excludes due = '' for
    // free. A full-ISO comparison would trip on 'T' sorting after ' '.
    //
    // Widened by a day on each side: a TIMED due date is stored as a UTC
    // instant, and one near local midnight sits on a different UTC day than
    // its local one. The host clips items to the range by instant, so the
    // over-fetch costs nothing and drops nothing.
    const startDay = toDateString(addDays(start, -1))
    const dayAfterEnd = toDateString(addDays(end, 2))

    // No membership filter: the PB rules already scope cards_cards sync to the
    // caller's member projects. Archived cards and cards on archived boards
    // are excluded to match search's policy — someone planning a week wants
    // active work, not history.
    const { data: rows, isLoading } = useOrgLiveQuery(
        query =>
            query
                .from({ card: cardsCollection })
                .innerJoin({ project: projectsCollection }, ({ card, project }) =>
                    eq(card.project, project.id)
                )
                .where(({ card, project }) =>
                    and(
                        gte(card.due, startDay),
                        lt(card.due, dayAfterEnd),
                        eq(card.archived, false),
                        eq(project.archived, false)
                    )
                )
                .select(({ card }) => ({
                    id: card.id,
                    title: card.title,
                    due: card.due,
                    due_has_time: card.due_has_time,
                })),
        [startDay, dayAfterEnd]
    )

    const items = useMemo(() => buildDueItems(rows ?? [], orgHref), [rows, orgHref])
    return { items, isLoading }
}
