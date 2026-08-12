import { and, eq, gte, lt } from '@tanstack/db'
import { addDays, toDateString } from '@tinycld/core/lib/dates'
import type { EventSourceItem, EventSourceRange } from '@tinycld/core/lib/event-sources/types'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import type { Href } from 'expo-router'
import { useMemo } from 'react'

// Calendar event source: cards with due dates, contributed via the manifest's
// `eventSources` entry. The calendar package mounts this hook through core's
// event-source registry — cards never imports calendar (lean shell), so the
// shared contract lives in @tinycld/core/lib/event-sources.

interface DueCardRow {
    id: string
    title: string
    due: string
}

/**
 * A stored due value → the LOCAL calendar day it names, or undefined.
 *
 * Mirrors board-project.ts's toDueDate (see the essay there): the picker
 * writes a bare 'YYYY-MM-DD', PocketBase returns 'YYYY-MM-DD 00:00:00.000Z',
 * and `new Date` on either lands at UTC midnight — the PREVIOUS day west of
 * Greenwich. Rebuilding from the UTC parts at local midnight keeps "due
 * tomorrow" on tomorrow's cell in every timezone.
 */
function dueLocalDay(due: string): Date | undefined {
    if (due === '') return undefined
    const parsed = new Date(due)
    if (Number.isNaN(parsed.getTime())) return undefined
    return new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
}

type HrefBuilder = (path: string, extra?: Record<string, string>) => Href

/** Pure mapping from due-card rows to source items, exported for tests. */
export function buildDueItems(
    rows: readonly DueCardRow[],
    orgHref: HrefBuilder
): EventSourceItem[] {
    const items: EventSourceItem[] = []
    for (const row of rows) {
        const day = dueLocalDay(row.due)
        if (!day) continue
        const endOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999)
        items.push({
            id: row.id,
            title: row.title,
            start: day.toISOString(),
            end: endOfDay.toISOString(),
            allDay: true,
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
    const startDay = toDateString(start)
    const dayAfterEnd = toDateString(addDays(end, 1))

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
                .select(({ card }) => ({ id: card.id, title: card.title, due: card.due })),
        [startDay, dayAfterEnd]
    )

    const items = useMemo(() => buildDueItems(rows ?? [], orgHref), [rows, orgHref])
    return { items, isLoading }
}
