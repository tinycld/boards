// The backlog view's model: the board's cards grouped by sprint, in the
// order the sprints read, each group in rank order.
//
// ONE RANK, TWO PROJECTIONS. A card's `position` is a fractional rank in a
// key space every card on the board shares (lib/rank.ts). The canvas orders a
// COLUMN by it; this view orders a SPRINT by it, across columns — the way
// Jira's backlog and board share one global rank. A drop in either view
// writes one rank, and the two views never disagree about what lies between
// two cards. The alternative, a second rank column for the backlog, would
// need its own backfill and a second DnD rank path for nothing the shared
// key space does not already give.

import type { BoardCardView, BoardProject, BoardSprint } from '../types'
import type { CardEntry } from './board-cards'
import { flattenCards } from './board-cards'
import { isClosedCategory } from './list-category'

export interface SectionTotals {
    count: number
    done: number
    points: number
    donePoints: number
}

export interface BacklogSection {
    /** The sprint id, or 'backlog' for the section holding unfiled cards. */
    key: string
    /** Null for the backlog section. */
    sprint: BoardSprint | null
    /** In rank order — `position, id` — across every list. */
    rows: CardEntry[]
    /**
     * `rows` reduced to cards, built ONCE here: drax treats a new data
     * reference as an external change and resets its layout, so a section
     * that mapped this on every render would reset drax on every render —
     * and a reset that re-renders the section is an infinite loop.
     */
    cards: BoardCardView[]
    /** Counted from the rows on screen, so a filter is reflected. */
    totals: SectionTotals
}

export interface Backlog {
    /** The active sprint (if any), the planned sprints in rank order, then the backlog. */
    sections: BacklogSection[]
    /** Completed sprints, most recent first, holding the cards still filed under them. */
    completed: BacklogSection[]
}

export const BACKLOG_KEY = 'backlog'

function byRank(a: CardEntry, b: CardEntry): number {
    if (a.card.position !== b.card.position) return a.card.position < b.card.position ? -1 : 1
    return a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0
}

function totalsOf(rows: CardEntry[]): SectionTotals {
    const totals: SectionTotals = { count: 0, done: 0, points: 0, donePoints: 0 }
    for (const { card } of rows) {
        const done = isClosedCategory(card.listCategory)
        const points = card.estimate ?? 0
        totals.count += 1
        totals.points += points
        if (done) {
            totals.done += 1
            totals.donePoints += points
        }
    }
    return totals
}

/**
 * Group the board's cards by sprint.
 *
 * The rows come from `project.lists`, which already carry the board filter,
 * so a filtered board shows a filtered backlog and the sections stay.
 *
 * The BACKLOG section hides cards in a done or canceled list: finished work
 * that was never in a sprint is not planning material, and Jira's backlog
 * hides it too. A sprint section KEEPS its closed cards — they are that
 * sprint's completed work, and the progress the header reports.
 */
export function buildBacklog(project: BoardProject): Backlog {
    const bySprint = new Map<string, CardEntry[]>()
    const unfiled: CardEntry[] = []
    for (const entry of flattenCards(project)) {
        const sprint = entry.card.sprint
        if (!sprint) {
            if (!isClosedCategory(entry.card.listCategory)) unfiled.push(entry)
            continue
        }
        const bucket = bySprint.get(sprint.id)
        if (bucket) bucket.push(entry)
        else bySprint.set(sprint.id, [entry])
    }

    const section = (
        key: string,
        sprint: BoardSprint | null,
        rows: CardEntry[]
    ): BacklogSection => {
        const sorted = [...rows].sort(byRank)
        return {
            key,
            sprint,
            rows: sorted,
            cards: sorted.map(row => row.card),
            totals: totalsOf(sorted),
        }
    }

    const sections: BacklogSection[] = []
    const completed: BacklogSection[] = []
    // `project.sprints` is already active → planned by rank → completed.
    for (const sprint of project.sprints) {
        const rows = bySprint.get(sprint.id) ?? []
        if (sprint.state === 'completed') completed.push(section(sprint.id, sprint, rows))
        else sections.push(section(sprint.id, sprint, rows))
    }
    sections.push(section(BACKLOG_KEY, null, unfiled))
    // Most recent first: the sprint just closed is the one someone looks for.
    completed.reverse()
    return { sections, completed }
}

/** The card ids the view renders, top to bottom, skipping collapsed sections. */
export function backlogVisibleOrder(
    backlog: Backlog,
    isCollapsed: (key: string) => boolean
): string[] {
    const order: string[] = []
    for (const section of [...backlog.sections, ...backlog.completed]) {
        if (isCollapsed(section.key)) continue
        for (const row of section.rows) order.push(row.card.id)
    }
    return order
}

/** The cards of a section, for the rank helpers and the sortable list. */
export function sectionCards(section: BacklogSection): BoardCardView[] {
    return section.cards
}
