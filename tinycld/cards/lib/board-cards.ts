import type { BoardCard, BoardList, ChecklistItem, SampleProject } from '../sample-projects'

export interface CardEntry {
    card: BoardCard
    list: BoardList
}

export interface ChecklistProgress {
    done: number
    total: number
    isComplete: boolean
}

export function checklistProgress(items: ChecklistItem[]): ChecklistProgress {
    const done = items.filter(item => item.isDone).length
    return { done, total: items.length, isComplete: done === items.length && items.length > 0 }
}

/** Cards in board order: list by list, top to bottom — the order J/K walks. */
export function flattenCards(project: SampleProject): CardEntry[] {
    return project.lists.flatMap(list => list.cards.map(card => ({ card, list })))
}

export function findCardEntry(project: SampleProject, cardId: string): CardEntry | null {
    return flattenCards(project).find(entry => entry.card.id === cardId) ?? null
}

/**
 * The card `delta` steps away in board order, clamped at the ends (no
 * wrap-around, matching mail's J/K behavior). Null when there's nowhere
 * to go so callers can no-op.
 */
export function neighborCardId(
    project: SampleProject,
    cardId: string,
    delta: number
): string | null {
    const entries = flattenCards(project)
    const index = entries.findIndex(entry => entry.card.id === cardId)
    if (index === -1) return null
    const next = Math.min(Math.max(index + delta, 0), entries.length - 1)
    return next === index ? null : entries[next].card.id
}

/**
 * Rebuild the project's lists with UI-store card moves applied. A moved card
 * is prepended to its target list (most recently moved on top); a card
 * "moved" to the list it already lives in keeps its original position.
 * Moves referencing unknown cards or lists are ignored.
 */
export function applyCardMoves(
    project: SampleProject,
    moves: Record<string, string>
): SampleProject {
    const moveIds = Object.keys(moves)
    if (moveIds.length === 0) return project

    const cardById = new Map(flattenCards(project).map(entry => [entry.card.id, entry.card]))
    const listIds = new Set(project.lists.map(list => list.id))
    const validMoveIds = moveIds.filter(id => cardById.has(id) && listIds.has(moves[id]))
    if (validMoveIds.length === 0) return project

    const lists = project.lists.map(list => {
        const kept = list.cards.filter(card => (moves[card.id] ?? list.id) === list.id)
        const incoming = validMoveIds
            .filter(id => moves[id] === list.id && !list.cards.some(card => card.id === id))
            .reverse()
            .flatMap(id => {
                const card = cardById.get(id)
                return card ? [card] : []
            })
        if (incoming.length === 0 && kept.length === list.cards.length) return list
        return { ...list, cards: [...incoming, ...kept] }
    })
    return { ...project, lists }
}
