// The board as a flat, ordered list of rows — what the table view renders.

import type { BoardCardView, BoardListView, BoardProject } from '../types'
import { flattenCards } from './board-cards'
import { type BoardSort, compareCards } from './board-sort'

export interface BoardRow {
    card: BoardCardView
    list: BoardListView
}

/**
 * Manual order is board order — list by list, top to bottom, exactly what
 * j/k walk on the canvas — so switching views never reshuffles. Any other
 * sort orders the WHOLE board by the field, ignoring list boundaries: a
 * table sorted by due date wants the soonest card first wherever it lives,
 * and the List column says where that is.
 */
export function flattenBoardRows(project: BoardProject, sort: BoardSort): BoardRow[] {
    const rows = flattenCards(project)
    if (sort.field === 'manual') return rows
    const compare = compareCards(sort)
    return [...rows].sort((a, b) => compare(a.card, b.card))
}
