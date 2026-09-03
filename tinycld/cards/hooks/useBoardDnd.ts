import { hapticSuccess } from '@tinycld/core/lib/haptics'
import { useWorkspaceStore } from '@tinycld/core/lib/stores/workspace-store'
import { useCallback, useEffect, useRef } from 'react'
import type {
    LayoutChangeEvent,
    NativeScrollEvent,
    NativeSyntheticEvent,
    ScrollView,
} from 'react-native'
import type {
    DraxMonitorDragDropEventData,
    DraxMonitorEndEventData,
    DraxMonitorEventData,
    DraxViewProps,
    SortableBoardHandle,
    SortableBoardTransferEvent,
} from 'react-native-drax'
import { useSortableBoard } from 'react-native-drax'
import type { EdgeDirection } from '../lib/dnd'
import {
    edgeScrollDirection,
    isCardDragPayload,
    isColumnDragPayload,
    setGrabbingCursor,
} from '../lib/dnd'
import { rankForAppend, rankForInsert } from '../lib/move'
import { selectBoardSort, useCardsUIStore } from '../stores/cards-ui-store'
import type { BoardCardView, BoardProject } from '../types'
import { useMoveCard } from './useCardMutations'

/** Fraction of the canvas width scrolled per auto-scroll tick. */
const EDGE_JUMP_RATIO = 0.15
const EDGE_SCROLL_INTERVAL_MS = 250

export interface BoardDnd {
    board: SortableBoardHandle<BoardCardView>
    canvasRef: React.RefObject<ScrollView | null>
    /** Monitor callbacks for the SortableBoardContainer's DraxView. */
    monitorProps: Partial<DraxViewProps>
    /** Columns register their Drax re-measure function here (null to remove). */
    registerColumnMeasure: (listId: string, measure: (() => void) | null) => void
    /**
     * Re-measure every registered column. Exposed because ANY change to column
     * widths invalidates the stored bounds findTargetColumn hit-tests against,
     * and collapsing one column shifts every column to its right. The internal
     * drag-start and canvas-scroll re-measures cannot see that: a collapse
     * between drags leaves stale bounds, so drops land in the wrong column.
     */
    measureAllColumns: () => void
    onCanvasScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
    onCanvasLayout: (event: LayoutChangeEvent) => void
}

/**
 * Board-level drag machinery: the cross-column transfer handler, canvas edge
 * auto-scroll, and the column-measurement refresh that keeps Drax's
 * hit-testing honest while the canvas scrolls.
 *
 * Why measurements need managing at all: SortableBoardContainer's
 * findTargetColumn compares the drag position against each column's stored
 * bounds with NO scroll compensation, and a plain ScrollView fires no
 * onLayout when it scrolls — so once the canvas moves, every column's stored
 * bounds are stale. The canvas can only move mid-drag through the edge
 * auto-scroll below (web freezes wheel/touch scrolling during a drag; on
 * native the dragging finger can't also scroll), so re-measuring every
 * column at drag start and on each canvas scroll event keeps the stored
 * bounds correct at the only moments they can drift.
 */
export function useBoardDnd(project: BoardProject, canEdit: boolean): BoardDnd {
    const moveCard = useMoveCard()
    const canvasRef = useRef<ScrollView>(null)

    const measureFnsRef = useRef(new Map<string, () => void>())
    const isDraggingRef = useRef(false)
    const scrollOffsetRef = useRef(0)
    const viewportWidthRef = useRef(0)
    const edgeDirectionRef = useRef<EdgeDirection>(0)
    const edgeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const registerColumnMeasure = useCallback((listId: string, measure: (() => void) | null) => {
        if (measure) {
            measureFnsRef.current.set(listId, measure)
        } else {
            measureFnsRef.current.delete(listId)
        }
    }, [])

    // Stable identity: BoardCanvas drives this from an effect keyed on the
    // collapsed set, and a fresh function each render would re-run it on every
    // board emission instead.
    //
    // Deliberately measures EVERY column rather than taking a subset: a width
    // change anywhere shifts every column to its right, so the affected set is
    // never just the columns that changed.
    const measureAllColumns = useCallback(() => {
        for (const measure of measureFnsRef.current.values()) measure()
    }, [])

    const stopEdgeScroll = () => {
        edgeDirectionRef.current = 0
        if (edgeIntervalRef.current) {
            clearInterval(edgeIntervalRef.current)
            edgeIntervalRef.current = null
        }
    }

    const setEdgeScroll = (direction: EdgeDirection) => {
        if (direction === edgeDirectionRef.current) return
        stopEdgeScroll()
        edgeDirectionRef.current = direction
        if (direction === 0) return
        edgeIntervalRef.current = setInterval(() => {
            const canvas = canvasRef.current
            if (!canvas) return
            const jump = viewportWidthRef.current * EDGE_JUMP_RATIO
            const next = Math.max(0, scrollOffsetRef.current + direction * jump)
            canvas.scrollTo({ x: next, animated: true })
        }, EDGE_SCROLL_INTERVAL_MS)
    }

    // Stop the interval (and reset the web cursor) if the board unmounts
    // mid-drag — e.g. the active project being archived under the user.
    useEffect(
        () => () => {
            if (edgeIntervalRef.current) clearInterval(edgeIntervalRef.current)
            setGrabbingCursor(false)
            // Without this a mid-drag unmount would leave the drawer's
            // edge-swipe suspended forever.
            useWorkspaceStore.getState().setEdgeSwipeSuspended(false)
        },
        []
    )

    const onTransfer = (event: SortableBoardTransferEvent<BoardCardView>) => {
        // Load-bearing, not belt-and-braces: Drax dispatches receive events
        // optimistically before acceptsDrag verdicts settle, so disabling the
        // drag sources alone does not guarantee a transfer can't commit.
        if (!canEdit) return
        // The target list can vanish mid-drag (deleted on another client).
        const target = project.lists.find(list => list.id === event.toContainerId)
        if (!target) return
        hapticSuccess()
        // Under a non-manual sort the target column is not in rank order, so
        // the drop index names a slot that has no rank meaning; the card
        // appends instead (after the column's highest rank) and settles into
        // its sorted place on the next render. Read imperatively: the sort
        // changes at rest, never mid-drag.
        const isSorted = selectBoardSort(useCardsUIStore.getState(), project.id).field !== 'manual'
        moveCard.mutate({
            cardId: event.item.id,
            listId: event.toContainerId,
            position: isSorted
                ? rankForAppend(target.cards)
                : rankForInsert(target.cards, event.toIndex),
        })
    }

    const board = useSortableBoard<BoardCardView>({
        keyExtractor: card => card.id,
        onTransfer,
    })

    const onMonitorDragStart = (event: DraxMonitorEventData) => {
        const payload = event.dragged.payload
        const isCard = isCardDragPayload(payload)
        // Cards and columns both get edge auto-scroll and the web cursor.
        if (!isCard && !isColumnDragPayload(payload)) return
        isDraggingRef.current = true
        measureAllColumns()
        setGrabbingCursor(true)
        // A drag routinely visits the left screen edge (that's what triggers
        // the auto-scroll), where a micro-lifted touch could otherwise read
        // as a drawer edge-swipe and fling the sidebar open mid-drag.
        useWorkspaceStore.getState().setEdgeSwipeSuspended(true)
        const ui = useCardsUIStore.getState()
        // Set for column drags too: the press guard should swallow a trailing
        // click no matter what kind of drag just released over a card.
        ui.setCardDragging(true)
        if (!isCard) return
        // The peek overlay doesn't block Drax hit-testing, so a drop "on" it
        // would land in whatever column it covers. Grabbing a card also means
        // the user is done reading — close it.
        if (ui.openCardId) ui.closeCard()
        // Drax's own hover and phantom-slot visuals own the board during a
        // drag; a stale ring left behind on the lifted card competes with them.
        if (ui.focusedCardId || ui.focusedColumnId) ui.focusCard(null)
    }

    const onMonitorDragOver = (event: DraxMonitorEventData) => {
        if (!isDraggingRef.current) return
        setEdgeScroll(edgeScrollDirection(event, viewportWidthRef.current))
    }

    const endDrag = () => {
        if (!isDraggingRef.current) return
        isDraggingRef.current = false
        stopEdgeScroll()
        setGrabbingCursor(false)
        useWorkspaceStore.getState().setEdgeSwipeSuspended(false)
        // One frame later so the trailing click a web drag-release can
        // synthesize still sees the flag (see BoardCard's onPress).
        requestAnimationFrame(() => useCardsUIStore.getState().setCardDragging(false))
    }

    const monitorProps: Partial<DraxViewProps> = {
        onMonitorDragStart,
        onMonitorDragOver,
        onMonitorDragExit: () => stopEdgeScroll(),
        onMonitorDragEnd: (_event: DraxMonitorEndEventData) => endDrag(),
        onMonitorDragDrop: (_event: DraxMonitorDragDropEventData) => endDrag(),
    }

    const onCanvasScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollOffsetRef.current = event.nativeEvent.contentOffset.x
        // Column bounds shift under the drag as the canvas scrolls.
        if (isDraggingRef.current) measureAllColumns()
    }

    const onCanvasLayout = (event: LayoutChangeEvent) => {
        viewportWidthRef.current = event.nativeEvent.layout.width
    }

    return {
        board,
        canvasRef,
        monitorProps,
        registerColumnMeasure,
        measureAllColumns,
        onCanvasScroll,
        onCanvasLayout,
    }
}
