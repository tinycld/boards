import { useEffect } from 'react'
import { selectionOrder } from '../lib/board-selection'
import { useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardProject } from '../types'

/**
 * Publishes the order a shift-range resolves against, for whichever view is
 * mounted — board order on the canvas, the row order in the table.
 *
 * An effect is the right primitive here for the same narrow reason
 * `useRemeasureOnCollapse` is: it reacts to a change in what is on SCREEN, and
 * what it writes is read imperatively at click time rather than rendered.
 * Nothing subscribes to `selectionOrderIds`, so the write costs no render.
 *
 * Dropping the selection is deliberately NOT done here. The three moments that
 * invalidate one — the board changes, the view changes, the filter changes —
 * are all store actions, and each clears it there, at the moment it happens.
 * The realtime case needs nothing at all: `resolveSelection` re-derives against
 * the live board and drops vanished ids at the point of use, which is what
 * keeps an effect from having to chase six live queries.
 */
export function useSelectionOrder(project: BoardProject, visibleOrder?: string[]) {
    const setSelectionOrder = useBoardsUIStore(s => s.setSelectionOrder)
    // Joined so the effect compares by VALUE: the array is rebuilt every render
    // (flattenCards maps), and a reference dep would write on every one.
    const orderKey = selectionOrder(project, visibleOrder).join(',')

    useEffect(() => {
        setSelectionOrder(orderKey === '' ? [] : orderKey.split(','))
    }, [orderKey, setSelectionOrder])
}
