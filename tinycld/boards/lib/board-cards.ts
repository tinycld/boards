import type { BoardCardView, BoardListView, BoardProject } from '../types'

export interface CardEntry {
    card: BoardCardView
    list: BoardListView
}

export interface ChecklistProgress {
    done: number
    total: number
    isComplete: boolean
}

/**
 * Structural on `isDone` rather than tied to one record shape, so it serves
 * both the board tree and the card-detail query.
 */
export function checklistProgress(items: { isDone: boolean }[]): ChecklistProgress {
    const done = items.filter(item => item.isDone).length
    return { done, total: items.length, isComplete: done === items.length && items.length > 0 }
}

/** Cards in board order: list by list, top to bottom — the order J/K walks. */
export function flattenCards(project: BoardProject): CardEntry[] {
    return project.lists.flatMap(list => list.cards.map(card => ({ card, list })))
}

export function findCardEntry(project: BoardProject, cardId: string): CardEntry | null {
    return flattenCards(project).find(entry => entry.card.id === cardId) ?? null
}

/**
 * The card `delta` steps away in board order, clamped at the ends (no
 * wrap-around, matching mail's J/K behavior). Null when there's nowhere
 * to go so callers can no-op.
 */
export function neighborCardId(
    project: BoardProject,
    cardId: string,
    delta: number
): string | null {
    const entries = flattenCards(project)
    const index = entries.findIndex(entry => entry.card.id === cardId)
    if (index === -1) return null
    const next = Math.min(Math.max(index + delta, 0), entries.length - 1)
    return next === index ? null : entries[next].card.id
}
