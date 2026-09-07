import type { BoardEpic } from '../types'

/**
 * Whether a card's details should offer an Epic row at all.
 *
 * A board with no epics is not using them — the row would only ever say "No
 * epics on this board yet" — so it stays hidden, the way the Sprint row does
 * on a board that does not plan in sprints. Epics are created from the board
 * menu (BoardMenu → Epics…), and the row appears once the first one exists.
 *
 * An archived epic no longer counts as one to file under, but a card already
 * filed under it keeps its row: the card must go on showing where it sits
 * even once the plan is closed to new work.
 */
export function boardUsesEpics(epics: BoardEpic[], card: { epic: BoardEpic | null }): boolean {
    if (card.epic) return true
    return epics.some(epic => !epic.archived)
}
