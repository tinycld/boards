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
import { BACKLOG_KEY, type Backlog, sectionCards } from '../lib/backlog'
import {
    type EdgeDirection,
    edgeScrollDirectionAlong,
    isCardDragPayload,
    setGrabbingCursor,
} from '../lib/dnd'
import { rankForInsert } from '../lib/move'
import { useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardCardView } from '../types'
import { useSetCardSprint } from './useCardMutations'

/** Fraction of the viewport height scrolled per auto-scroll tick. */
const EDGE_JUMP_RATIO = 0.15
const EDGE_SCROLL_INTERVAL_MS = 250

export interface BacklogDnd {
    board: SortableBoardHandle<BoardCardView>
    scrollRef: React.RefObject<ScrollView | null>
    monitorProps: Partial<DraxViewProps>
    /** Sections register their Drax re-measure here (null to remove). */
    registerSectionMeasure: (key: string, measure: (() => void) | null) => void
    measureAllSections: () => void
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
    onLayout: (event: LayoutChangeEvent) => void
}

/**
 * The backlog's drag machinery — useBoardDnd turned on its side, and a
 * separate hook because almost nothing in that one carries over: its
 * transfer writes `list` + `position`, its re-measures follow horizontal
 * scroll, and its edge auto-scroll reads the finger's x.
 *
 * Here the sections are stacked in ONE vertical page scroll. drax's
 * SortableBoardContainer hit-tests a drag against each section's stored
 * absolute bounds with no scroll compensation, so every section is
 * re-measured at drag start and on every page scroll — the same discipline
 * the canvas applies to its columns. The sections' own SortableContainers
 * get a scroll ref that never resolves: a section does not scroll, the page
 * does, so their per-container auto-scroll and web scroll freeze must stay
 * inert and the page-level auto-scroll below does the job instead.
 *
 * A drop writes `sprint` + `position` in one update and never `list` —
 * lib/backlog.ts explains the shared rank. The rank comes from the target
 * section's rows in rank order, so a card dropped between two cards from
 * different lists takes a rank between theirs, which is where it reappears
 * on the canvas relative to each.
 */
export function useBacklogDnd(backlog: Backlog, canEdit: boolean): BacklogDnd {
    const setCardSprint = useSetCardSprint()
    const scrollRef = useRef<ScrollView>(null)

    const measureFnsRef = useRef(new Map<string, () => void>())
    const isDraggingRef = useRef(false)
    const scrollOffsetRef = useRef(0)
    const viewportHeightRef = useRef(0)
    const edgeDirectionRef = useRef<EdgeDirection>(0)
    const edgeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const registerSectionMeasure = useCallback((key: string, measure: (() => void) | null) => {
        if (measure) measureFnsRef.current.set(key, measure)
        else measureFnsRef.current.delete(key)
    }, [])

    const measureAllSections = useCallback(() => {
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
            const scroll = scrollRef.current
            if (!scroll) return
            const jump = viewportHeightRef.current * EDGE_JUMP_RATIO
            const next = Math.max(0, scrollOffsetRef.current + direction * jump)
            scroll.scrollTo({ y: next, animated: true })
        }, EDGE_SCROLL_INTERVAL_MS)
    }

    useEffect(
        () => () => {
            if (edgeIntervalRef.current) clearInterval(edgeIntervalRef.current)
            setGrabbingCursor(false)
            useWorkspaceStore.getState().setEdgeSwipeSuspended(false)
        },
        []
    )

    const onTransfer = (event: SortableBoardTransferEvent<BoardCardView>) => {
        // Load-bearing, as on the canvas: drax dispatches receive events
        // optimistically, so the sources being fixed is not enough.
        if (!canEdit) return
        const target = backlog.sections.find(section => section.key === event.toContainerId)
        if (!target) return
        hapticSuccess()
        setCardSprint.mutate({
            cardId: event.item.id,
            sprintId: target.key === BACKLOG_KEY ? '' : target.key,
            position: rankForInsert(sectionCards(target), event.toIndex),
        })
    }

    const board = useSortableBoard<BoardCardView>({
        keyExtractor: card => card.id,
        onTransfer,
    })

    const onMonitorDragStart = (event: DraxMonitorEventData) => {
        if (!isCardDragPayload(event.dragged.payload)) return
        isDraggingRef.current = true
        measureAllSections()
        setGrabbingCursor(true)
        useWorkspaceStore.getState().setEdgeSwipeSuspended(true)
        const ui = useBoardsUIStore.getState()
        ui.setCardDragging(true)
        if (ui.openCardId) ui.closeCard()
        if (ui.focusedCardId || ui.focusedColumnId) ui.focusCard(null)
    }

    const onMonitorDragOver = (event: DraxMonitorEventData) => {
        if (!isDraggingRef.current) return
        setEdgeScroll(edgeScrollDirectionAlong(event, viewportHeightRef.current, 'y'))
    }

    const endDrag = () => {
        if (!isDraggingRef.current) return
        isDraggingRef.current = false
        stopEdgeScroll()
        setGrabbingCursor(false)
        useWorkspaceStore.getState().setEdgeSwipeSuspended(false)
        requestAnimationFrame(() => useBoardsUIStore.getState().setCardDragging(false))
    }

    const monitorProps: Partial<DraxViewProps> = {
        onMonitorDragStart,
        onMonitorDragOver,
        onMonitorDragExit: () => stopEdgeScroll(),
        onMonitorDragEnd: (_event: DraxMonitorEndEventData) => endDrag(),
        onMonitorDragDrop: (_event: DraxMonitorDragDropEventData) => endDrag(),
    }

    const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollOffsetRef.current = event.nativeEvent.contentOffset.y
        // Section bounds shift under the drag as the page scrolls.
        if (isDraggingRef.current) measureAllSections()
    }

    const onLayout = (event: LayoutChangeEvent) => {
        viewportHeightRef.current = event.nativeEvent.layout.height
    }

    return {
        board,
        scrollRef,
        monitorProps,
        registerSectionMeasure,
        measureAllSections,
        onScroll,
        onLayout,
    }
}
