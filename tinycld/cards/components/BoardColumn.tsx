import { hapticImpactLight, hapticSelection, hapticSuccess } from '@tinycld/core/lib/haptics'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { memo, useRef, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import type { DraxDragWithReceiverEventData, DraxMonitorEventData } from 'react-native-drax'
import { DraxView, SortableContainer, SortableItem, useSortableList } from 'react-native-drax'
import type { SharedValue } from 'react-native-reanimated'
import Reanimated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { useCreateCard, useMoveCard } from '../hooks/useCardMutations'
import { useUpdateList } from '../hooks/useListMutations'
import {
    CARD_DRAG_ACTIVATION_MS,
    COLUMN_DRAG_ACTIVATION_MS,
    columnDropIndex,
    isCardDragPayload,
    isColumnDragPayload,
} from '../lib/dnd'
import { rankForAppend, rankForReorder } from '../lib/move'
import type { BoardCardView, BoardListRank, BoardListView } from '../types'
import { BoardCard } from './BoardCard'
import { CardComposer } from './CardComposer'
import { ColumnMenu } from './ColumnMenu'
import { NoNativeDrag } from './NoNativeDrag'

export const COLUMN_WIDTH = 284

/** The floating copy while a card is dragged: a slight lift and tilt.
 *  shadowColor is left at its default (black) — a shadow is a shadow in both
 *  themes, and the card face underneath keeps its own theming. */
const CARD_HOVER_STYLE = {
    opacity: 0.97,
    transform: [{ scale: 1.03 }, { rotate: '2deg' }],
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
}

interface BoardColumnProps {
    list: BoardListView
    projectId: string
    /** Every column's rank, in render order — the menu's reorder and the
     *  header-drag drop index need siblings, but only their {id, position}.
     *  Identity-stable across card-level changes (see BoardProject.listOrder),
     *  which is what lets the memo below skip untouched columns. */
    listOrder: BoardListRank[]
    /** From useBoardDnd — keeps this column's Drax bounds fresh while the
     *  canvas scrolls under a drag. */
    registerMeasure: (listId: string, measure: (() => void) | null) => void
    /** viaWriter — every affordance in this column mutates content. */
    canEdit: boolean
}

type DropSide = 'before' | 'after'

/**
 * Memoized: a live-query emission that changes one card must re-render only
 * that card's column. Structural sharing in buildBoardProject keeps every
 * untouched column's `list` (and `listOrder`) identity stable, so the other
 * columns — including their drax sortable state — are left alone. Without
 * this boundary, every emission re-rendered every column, and a re-render
 * mid-drag is what wiped the phantom-slot preview.
 */
export const BoardColumn = memo(function BoardColumn({
    list,
    projectId,
    listOrder,
    registerMeasure,
    canEdit,
}: BoardColumnProps) {
    const [isRenaming, setIsRenaming] = useState(false)
    const [isReceiving, setIsReceiving] = useState(false)
    const [columnDropSide, setColumnDropSide] = useState<DropSide | null>(null)
    const createCard = useCreateCard(projectId)
    const updateList = useUpdateList()
    const barColor = useThemeColor('primary')

    const addCard = (title: string) =>
        createCard.mutate({ listId: list.id, title, position: rankForAppend(list.cards) })

    const sideFor = (event: DraxDragWithReceiverEventData): DropSide =>
        event.receiver.receiveOffsetRatio.x < 0.5 ? 'before' : 'after'

    // acceptsDrag alone is not enough to gate the handlers: Drax dispatches
    // the first receive events optimistically and applies the acceptsDrag
    // verdict a frame later, and a rejected receiver never gets the Exit that
    // would clear its state — the source column would strand a 'before' bar
    // for the whole drag. Re-check the payload (and canEdit) in every handler.
    const isForeignColumn = (event: DraxDragWithReceiverEventData) => {
        const payload = event.dragged.payload
        return canEdit && isColumnDragPayload(payload) && payload.listId !== list.id
    }

    const dropColumn = (event: DraxDragWithReceiverEventData) => {
        setColumnDropSide(null)
        const payload = event.dragged.payload
        if (!isForeignColumn(event) || !isColumnDragPayload(payload)) return
        const index = columnDropIndex(listOrder, payload.listId, list.id, sideFor(event))
        if (index === null) return
        hapticSuccess()
        updateList.mutate({
            listId: payload.listId,
            position: rankForReorder(listOrder, payload.listId, index),
        })
    }

    return (
        <DraxView
            receptive
            monitoring
            acceptsDrag={payload =>
                canEdit && isColumnDragPayload(payload) && payload.listId !== list.id
            }
            onReceiveDragOver={event => {
                if (!isForeignColumn(event)) return
                const side = sideFor(event)
                // Every-frame event; only touch state when the side flips.
                setColumnDropSide(previous => (previous === side ? previous : side))
            }}
            onReceiveDragExit={() => setColumnDropSide(null)}
            onReceiveDragDrop={dropColumn}
            // A drag cancelled mid-hover fires no Exit; the monitor end events
            // are the backstop that clears the bar.
            onMonitorDragEnd={() => setColumnDropSide(null)}
            onMonitorDragDrop={() => setColumnDropSide(null)}
            style={{ maxHeight: '100%' }}
        >
            <View
                // The border is always present (transparent at rest) so the
                // receiving highlight never shifts layout.
                className={`bg-foreground/[0.04] rounded-[14px] p-1.5 max-h-full border-2 ${
                    isReceiving ? 'border-ring' : 'border-transparent'
                }`}
                style={{ width: COLUMN_WIDTH }}
            >
                <View className="flex-row items-center gap-2 pl-3 pr-2.5 py-2">
                    {isRenaming ? (
                        // Keyed on the current name so each rename session mounts a
                        // fresh input seeded from the CURRENT value. Without the
                        // remount the draft state would persist, and a second
                        // rename would open showing the first one's text.
                        <ColumnNameInput
                            key={list.name}
                            list={list}
                            onDone={() => setIsRenaming(false)}
                        />
                    ) : (
                        <ColumnDragHandle list={list} canDrag={canEdit} />
                    )}
                    <View className="flex-1" />
                    {/* Hiding the menu also removes the only rename entry point
                        (onRename fires nowhere else), so ColumnNameInput needs
                        no gate of its own. */}
                    {canEdit ? (
                        <ColumnMenu
                            list={list}
                            listOrder={listOrder}
                            onRename={() => setIsRenaming(true)}
                        />
                    ) : null}
                </View>
                <ColumnCards
                    list={list}
                    registerMeasure={registerMeasure}
                    onReceivingChange={setIsReceiving}
                    canEdit={canEdit}
                />
                {canEdit ? (
                    <CardComposer onSubmit={addCard} isPending={createCard.isPending} />
                ) : null}
                {isReceiving ? <View testID="cards-column-receiving" /> : null}
            </View>
            <ColumnInsertionBar side={columnDropSide} color={barColor} />
        </DraxView>
    )
})

/** The 3px bar previewing where a dragged column will land. Sits in the gap
 *  beside the column (the canvas gap is 12px), never inside its rounding. */
function ColumnInsertionBar({ side, color }: { side: DropSide | null; color: string }) {
    if (!side) return null
    return (
        <View
            testID="cards-column-insertion-bar"
            pointerEvents="none"
            style={{
                position: 'absolute',
                top: 6,
                bottom: 6,
                width: 3,
                borderRadius: 2,
                backgroundColor: color,
                ...(side === 'before' ? { left: -8 } : { right: -8 }),
            }}
        />
    )
}

/**
 * The column title and count, draggable to reorder the whole column.
 * ColumnMenu stays outside it — menu taps must never start a drag. The
 * region is kept at its INTRINSIC size (no flex-1): Drax's hit-test anchors
 * at the hover view's center, offset by where the grab happened inside the
 * source view, so a wide handle drags a hit point far from the pointer and
 * drops land a column to the right of where the user aims (drive's DragGrip
 * documents the same lesson). The floating copy is a compact header pill —
 * cheap, and honest about what is being moved.
 */
function ColumnDragHandle({ list, canDrag }: { list: BoardListView; canDrag: boolean }) {
    return (
        <DraxView
            draggable={canDrag}
            dragPayload={{ kind: 'cards-column', listId: list.id }}
            longPressDelay={COLUMN_DRAG_ACTIVATION_MS}
            draggingStyle={{ opacity: 0.35 }}
            renderHoverContent={() => <ColumnDragGhost list={list} />}
            accessibilityLabel="Drag to move list"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
        >
            <NoNativeDrag>
                <ColumnTitle list={list} />
            </NoNativeDrag>
        </DraxView>
    )
}

function ColumnDragGhost({ list }: { list: BoardListView }) {
    return (
        <View
            className="flex-row items-center gap-2 bg-card border border-border rounded-[10px] px-3 py-2"
            style={{
                transform: [{ rotate: '2deg' }],
                shadowOpacity: 0.25,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 8 },
                elevation: 8,
            }}
        >
            <ColumnTitle list={list} />
        </View>
    )
}

/** The column name and its card count. */
function ColumnTitle({ list }: { list: BoardListView }) {
    return (
        <>
            <Text className="text-[13px] font-semibold text-foreground" numberOfLines={1}>
                {list.name}
            </Text>
            <View className="bg-foreground/[0.06] rounded-full px-1.5 py-px">
                <Text className="text-[11px] font-semibold text-muted">{list.cards.length}</Text>
            </View>
        </>
    )
}

/** The rename input. Mounted only while renaming — see the key at its call site. */
function ColumnNameInput({ list, onDone }: { list: BoardListView; onDone: () => void }) {
    const [draft, setDraft] = useState(list.name)
    const updateList = useUpdateList()
    const mutedColor = useThemeColor('muted')

    const commit = () => {
        onDone()
        const trimmed = draft.trim()
        // A blank name would leave a column with no header at all, so an empty
        // submit reverts rather than saving.
        if (!trimmed || trimmed === list.name) {
            setDraft(list.name)
            return
        }
        updateList.mutate({ listId: list.id, name: trimmed })
    }

    return (
        <PlainInput
            value={draft}
            onChangeText={setDraft}
            placeholderTextColor={mutedColor}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={commit}
            onBlur={commit}
            onKeyPress={e => {
                if (e.nativeEvent.key === 'Escape') {
                    setDraft(list.name)
                    onDone()
                }
            }}
            className="flex-1 text-[13px] font-semibold text-foreground"
        />
    )
}

/** The card stack's flex gap (contentContainerClassName="gap-2"). */
const STACK_GAP = 8

/** Room reserved below the stack for the phantom slot while receiving —
 *  one standard card face; the stack gap in front of the spacer supplies
 *  the rest. */
const PHANTOM_SLOT_HEIGHT = 40

interface ColumnCardsProps {
    list: BoardListView
    registerMeasure: (listId: string, measure: (() => void) | null) => void
    /** Reports whether a card from ANOTHER column is dragged over this one.
     *  Consumed by BoardColumn (border + e2e marker) — never fed back here,
     *  so the flip cannot re-render this subtree. */
    onReceivingChange: (isReceiving: boolean) => void
    canEdit: boolean
}

/**
 * The column's card stack, as a Drax sortable list. Cross-column moves are
 * handled by the board container (useBoardDnd's onTransfer); this list only
 * commits same-column reorders. The container mounts even when the column is
 * empty — it is the drop target, and a null here would leave an empty column
 * with no bounds to hit-test and no place for the phantom slot.
 *
 * Memoized and deliberately state-free: a re-render mid-drag re-measures
 * every SortableItem while its shift transform is still animating, storing
 * origins corrupted by the un-travelled remainder — the landing slot then
 * oscillates and gaps stick around after the drop. The drax fork now guards
 * against mid-drag re-measures too, but not re-rendering at all is the cheap
 * half of the fix, and it is why receiving feedback leaves this subtree
 * untouched: the border lives in BoardColumn behind the memo boundary, and
 * the phantom room is a SharedValue-driven spacer.
 */
const ColumnCards = memo(function ColumnCards({
    list,
    registerMeasure,
    onReceivingChange,
    canEdit,
}: ColumnCardsProps) {
    const scrollRef = useRef<ScrollView>(null)
    const moveCard = useMoveCard()
    const phantomSpace = useSharedValue(0)

    const sortable = useSortableList<BoardCardView>({
        // Container id === list id, so the board's transfer events speak list ids.
        id: list.id,
        data: list.cards,
        keyExtractor: card => card.id,
        onReorder: event => {
            if (event.fromIndex === event.toIndex) return
            hapticSuccess()
            moveCard.mutate({
                cardId: event.fromItem.id,
                listId: list.id,
                position: rankForReorder(list.cards, event.fromItem.id, event.toIndex),
            })
        },
        longPressDelay: CARD_DRAG_ACTIVATION_MS,
        animationConfig: 'snappy',
        inactiveItemStyle: { opacity: 0.75 },
        onDragStart: () => hapticImpactLight(),
    })

    // A drag over this column counts as "receiving" only when the card came
    // from elsewhere — reordering a column over itself needs no highlight,
    // the moving gap already shows the landing slot.
    const isForeignCard = (event: DraxMonitorEventData) => {
        const payload = event.dragged.payload
        return isCardDragPayload(payload) && payload.listId !== list.id
    }

    // Enter/exit alone cannot drive the highlight: Drax pads monitor bounds
    // by ~100px (so auto-scroll can't cause false exits), and columns sit
    // 12px apart — a card between two columns is "inside" both monitors and
    // the one just left keeps its highlight. monitorOffsetRatio is relative
    // to the REAL bounds, so gate on it every frame instead; exactly one
    // column can satisfy it at a time.
    const wasReceivingRef = useRef(false)
    const updateReceiving = (event: DraxMonitorEventData) => {
        const { x, y } = event.monitorOffsetRatio
        const receiving = isForeignCard(event) && x >= 0 && x <= 1 && y >= 0 && y <= 1
        if (receiving !== wasReceivingRef.current) {
            // The tick a finger feels crossing into a new column.
            if (receiving) hapticSelection()
            wasReceivingRef.current = receiving
            phantomSpace.value = receiving ? PHANTOM_SLOT_HEIGHT : 0
        }
        onReceivingChange(receiving)
    }
    const clearReceiving = () => {
        wasReceivingRef.current = false
        phantomSpace.value = 0
        onReceivingChange(false)
    }

    return (
        <SortableContainer
            sortable={sortable}
            scrollRef={scrollRef}
            draxViewProps={{
                registration: registration =>
                    registerMeasure(list.id, registration ? () => registration.measure() : null),
                onMonitorDragEnter: updateReceiving,
                onMonitorDragOver: updateReceiving,
                onMonitorDragExit: clearReceiving,
                onMonitorDragEnd: clearReceiving,
                onMonitorDragDrop: clearReceiving,
            }}
        >
            <ScrollView
                ref={scrollRef}
                className="shrink"
                contentContainerClassName="gap-2 p-0.5"
                // A finger-sized landing area when the column has no cards. No
                // empty-state text: the composer below is the affordance, and
                // "No cards yet" above an "Add card" button says nothing the
                // button doesn't.
                contentContainerStyle={{ minHeight: 56 }}
                onScroll={sortable.onScroll}
                scrollEventThrottle={16}
                onContentSizeChange={sortable.onContentSizeChange}
            >
                {sortable.data.map((card, index) => (
                    <SortableItem
                        key={sortable.stableKeyExtractor(card, index)}
                        sortable={sortable}
                        index={index}
                        payload={{ kind: 'cards-card', cardId: card.id, listId: list.id }}
                        hoverDraggingStyle={CARD_HOVER_STYLE}
                        fixed={!canEdit}
                    >
                        <NoNativeDrag>
                            <BoardCard card={card} isDone={list.isDone} canDrag={canEdit} />
                        </NoNativeDrag>
                    </SortableItem>
                ))}
                <PhantomSlotSpacer space={phantomSpace} />
            </ScrollView>
        </SortableContainer>
    )
})

/**
 * Layout room for the cross-column phantom slot, grown while a foreign card
 * hovers over this column. The slot shifts are pure transforms, so without
 * real room the last resident slides past the container edge and gets
 * clipped, and a drop aimed at the vacated space lands outside the column's
 * bounds and cancels the transfer. Height is a SharedValue so the mid-drag
 * toggle never re-renders (and re-measures) the items above; at rest the
 * negative margin swallows the stack gap the spacer would otherwise add.
 */
function PhantomSlotSpacer({ space }: { space: SharedValue<number> }) {
    const style = useAnimatedStyle(() => ({
        height: space.value,
        marginTop: space.value > 0 ? 0 : -STACK_GAP,
    }))
    return <Reanimated.View style={style} />
}
