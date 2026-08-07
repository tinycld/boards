import type { BoardListView, BoardProject } from '../types'

/**
 * Where the keyboard focus ring sits. Exactly one of the two is set: a column
 * with no cards can still be focused (so "new card here" has a target), and a
 * focused card always implies its own column, which is why the column is not
 * stored alongside it — see the store.
 */
export interface FocusTarget {
    cardId: string | null
    columnId: string
}

function columnIndexOf(project: BoardProject, columnId: string): number {
    return project.lists.findIndex(list => list.id === columnId)
}

/**
 * The column and card focus lands on when stepping one column left or right.
 *
 * Focus keeps its ROW INDEX across the step rather than snapping to the top of
 * the next column: moving along a row and back should return you where you
 * started. A shorter target column clamps to its last card, and an empty one
 * takes focus as a column. Null at the edges so callers no-op.
 */
export function columnStep(
    project: BoardProject,
    focusedCardId: string | null,
    focusedColumnId: string | null,
    delta: 1 | -1
): FocusTarget | null {
    let fromIndex = -1
    let rowIndex = 0

    if (focusedCardId) {
        fromIndex = project.lists.findIndex(list =>
            list.cards.some(card => card.id === focusedCardId)
        )
        if (fromIndex === -1) return null
        rowIndex = project.lists[fromIndex].cards.findIndex(card => card.id === focusedCardId)
    } else if (focusedColumnId) {
        fromIndex = columnIndexOf(project, focusedColumnId)
        if (fromIndex === -1) return null
    } else {
        return null
    }

    const toIndex = fromIndex + delta
    const target = project.lists[toIndex]
    if (!target) return null

    if (target.cards.length === 0) return { cardId: null, columnId: target.id }

    const landing = Math.min(rowIndex, target.cards.length - 1)
    return { cardId: target.cards[landing].id, columnId: target.id }
}

/**
 * The column a focused card moves into when stepped one column over. Null at
 * the edges. Only picks the destination — the rank within it comes from
 * lib/move.ts, unchanged.
 */
export function targetColumnForMove(
    project: BoardProject,
    cardId: string,
    delta: 1 | -1
): BoardListView | null {
    const fromIndex = project.lists.findIndex(list => list.cards.some(card => card.id === cardId))
    if (fromIndex === -1) return null
    return project.lists[fromIndex + delta] ?? null
}

/**
 * The scroll offset that brings a target into view, or null when it already is
 * — returning null is what keeps stepping within a visible column from
 * scrolling on every keypress. A target taller/wider than the viewport aligns
 * to its start rather than oscillating between the two edges.
 */
export function scrollOffsetFor(
    current: number,
    viewport: number,
    targetStart: number,
    targetSize: number
): number | null {
    if (targetStart < current) return Math.max(targetStart, 0)
    const targetEnd = targetStart + targetSize
    if (targetEnd > current + viewport) {
        if (targetSize >= viewport) return Math.max(targetStart, 0)
        return Math.max(targetEnd - viewport, 0)
    }
    return null
}
