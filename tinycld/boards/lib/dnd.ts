import { Platform } from 'react-native'

/**
 * How a drag activates, per platform.
 *
 * Web/desktop: 0 — no time-based activation. Drax forwards this to RNGH as
 * `activateAfterLongPress`, and a non-zero value makes the gesture activate on
 * a *timer* while the pointer is held still, turning an ordinary
 * click-and-hold into an instant drag. With 0, RNGH falls back to its movement
 * threshold (~15px touch-slop): a drag begins only once the pointer actually
 * moves, so a plain click still opens the card.
 *
 * Native (touch): a hold. Cards live inside a vertically scrolling column, so
 * the hold must be long enough that a quick swipe reads as a scroll, not a
 * grab — drive uses 120ms on grid cards that don't scroll; a card column
 * needs a little more.
 */
export const CARD_DRAG_ACTIVATION_MS = Platform.OS === 'web' ? 0 : 200

/** Column headers compete with nothing scrollable, so a shorter hold is fine. */
export const COLUMN_DRAG_ACTIVATION_MS = Platform.OS === 'web' ? 0 : 150

/**
 * Payload carried by a card drag. `kind` lets receivers reject foreign
 * payloads (a column drag, an OS file drag) up front; `listId` is the SOURCE
 * column, captured at drag start — a column uses it to tell its own cards
 * from incoming ones.
 */
export interface CardDragPayload {
    kind: 'boards-card'
    cardId: string
    listId: string
}

export function isCardDragPayload(payload: unknown): payload is CardDragPayload {
    return (
        typeof payload === 'object' &&
        payload !== null &&
        (payload as CardDragPayload).kind === 'boards-card'
    )
}

/** Payload carried by a column drag (the list id being reordered). */
export interface ColumnDragPayload {
    kind: 'boards-column'
    listId: string
}

export function isColumnDragPayload(payload: unknown): payload is ColumnDragPayload {
    return (
        typeof payload === 'object' &&
        payload !== null &&
        (payload as ColumnDragPayload).kind === 'boards-column'
    )
}

/**
 * Which single item moved between two orderings of the same ids, and where it
 * ended up. Recovers the moved row from core SortableList's onReorder, which
 * reports only the final array. Returns null when nothing moved.
 *
 * At the first index where the arrays disagree there are only two cases: the
 * old occupant moved AWAY (forward), so the new array shows its old right-hand
 * neighbour; or the new occupant moved IN (backward) from later in the list.
 */
export function movedEntry(
    oldIds: string[],
    newIds: string[]
): { id: string; index: number } | null {
    if (oldIds.length !== newIds.length) return null
    const first = oldIds.findIndex((id, index) => id !== newIds[index])
    if (first === -1) return null

    if (newIds[first] === oldIds[first + 1]) {
        const id = oldIds[first]
        return { id, index: newIds.indexOf(id) }
    }
    return { id: newIds[first], index: first }
}

/**
 * Final index for a column dropped before/after `targetListId`, suitable for
 * `rankForReorder(lists, draggedListId, index)`. Returns null for drops that
 * would not move anything: unknown ids, a column dropped onto itself, or onto
 * the edge it already sits against.
 */
export function columnDropIndex(
    lists: { id: string }[],
    draggedListId: string,
    targetListId: string,
    side: 'before' | 'after'
): number | null {
    if (draggedListId === targetListId) return null
    const draggedIndex = lists.findIndex(list => list.id === draggedListId)
    if (draggedIndex === -1) return null

    const remaining = lists.filter(list => list.id !== draggedListId)
    const targetIndex = remaining.findIndex(list => list.id === targetListId)
    if (targetIndex === -1) return null

    const insertIndex = side === 'before' ? targetIndex : targetIndex + 1
    // Re-inserting where the column already sits reproduces the current order.
    if (insertIndex === draggedIndex) return null
    return insertIndex
}

export type EdgeDirection = -1 | 0 | 1

/** Fraction of the canvas width, at each edge, that triggers auto-scroll. */
const EDGE_ZONE_RATIO = 0.08
/** Zone floor: 8% of a phone canvas is a sliver nobody can hold a finger in,
 *  so narrow viewports get a fixed finger-sized band instead. */
const EDGE_ZONE_MIN_PT = 48

/** The monitor-event fields the edge computation reads — structurally a subset
 *  of DraxMonitorEventData, so tests can build one without the full event. */
export interface EdgeScrollSample {
    dragAbsolutePosition: { x: number }
    monitorOffset: { x: number }
    dragged: {
        grabOffset: { x: number }
        hoverPosition: { x: number }
    }
}

/**
 * Which way the canvas should auto-scroll for a drag sample, from the
 * FINGER's position — not the event's monitor offset. Drax hit-tests at the
 * center of the hovering card, so `monitorOffsetRatio` lags/leads the finger
 * by up to half a card width (~136pt) depending on where the card was
 * grabbed. On a desktop canvas the ratio zone dwarfs that error; on a
 * phone-width canvas it is smaller than the error, leaving the zone
 * unreachable — the finger sits at the screen edge while the tracked center
 * never enters it. Recover the finger instead:
 *
 * - hoverPosition is the hover copy's root-relative top-left, placed at
 *   finger − grabOffset, so finger = hoverPosition + grabOffset;
 * - dragAbsolutePosition and monitorOffset name the same hit-test point
 *   root- and monitor-relatively, so their difference is the monitor origin.
 */
export function edgeScrollDirection(event: EdgeScrollSample, viewportWidth: number): EdgeDirection {
    if (viewportWidth <= 0) return 0
    const fingerRootX = event.dragged.hoverPosition.x + event.dragged.grabOffset.x
    const monitorOriginX = event.dragAbsolutePosition.x - event.monitorOffset.x
    const fingerX = fingerRootX - monitorOriginX
    const zone = Math.max(EDGE_ZONE_MIN_PT, viewportWidth * EDGE_ZONE_RATIO)
    if (fingerX <= zone) return -1
    if (fingerX >= viewportWidth - zone) return 1
    return 0
}

/**
 * Body-wide `grabbing` cursor while a drag is live (web only). The hover copy
 * under the pointer is a plain View, so without this the browser shows the
 * default arrow mid-drag.
 */
export function setGrabbingCursor(on: boolean) {
    if (Platform.OS !== 'web') return
    document.body.style.cursor = on ? 'grabbing' : ''
}
