import { hapticImpactLight, hapticSelection, hapticSuccess } from '@tinycld/core/lib/haptics'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { memo, useRef, useState } from 'react'
import { Text, View } from 'react-native'
import type { DraxMonitorEventData } from 'react-native-drax'
import { SortableContainer, SortableItem, useSortableList } from 'react-native-drax'
import Reanimated, {
    type SharedValue,
    useAnimatedStyle,
    useSharedValue,
} from 'react-native-reanimated'
import { useSetCardSprint } from '../../hooks/useCardMutations'
import { useCardSelection } from '../../hooks/useCardSelection'
import { type BacklogSection, sectionCards } from '../../lib/backlog'
import type { CardEntry } from '../../lib/board-cards'
import { CARD_DRAG_ACTIVATION_MS, isCardDragPayload } from '../../lib/dnd'
import { rankForReorder } from '../../lib/move'
import { useBoardsUIStore } from '../../stores/boards-ui-store'
import type { BoardCardView } from '../../types'
import { NoNativeDrag } from '../NoNativeDrag'
import { CardRow } from '../table/CardRow'
import { SprintSectionHeader } from './SprintSectionHeader'

/** Room reserved below the rows for the phantom slot while receiving. */
const PHANTOM_SLOT_HEIGHT = 40
const ROW_HOVER_STYLE = { opacity: 0.9 } as const

interface SprintSectionProps {
    section: BacklogSection
    projectId: string
    canEdit: boolean
    isMobile: boolean
    isCollapsed: boolean
    onToggleCollapsed: () => void
    registerMeasure: (key: string, measure: (() => void) | null) => void
    /** Header slots the backlog view fills: sprint actions, "+ New sprint". */
    headerActions?: React.ReactNode
}

/**
 * One section of the backlog view: a sprint (or the backlog) and its rows.
 *
 * The BoardColumn split, turned on its side: the header and the receiving
 * border live here, the rows in a memoized, state-free SectionRows below —
 * so a mid-drag highlight never re-renders (and re-measures) the sortable
 * items. A collapsed section renders only its header and mounts no sortable
 * container, so it is not a drop target; the sprint picker on the row and
 * the bulk bar remain the ways into it.
 */
export function SprintSection({
    section,
    projectId,
    canEdit,
    isMobile,
    isCollapsed,
    onToggleCollapsed,
    registerMeasure,
    headerActions,
}: SprintSectionProps) {
    const [isReceiving, setIsReceiving] = useState(false)
    const borderColor = useThemeColor('primary')

    return (
        <View
            testID={`boards-section-${section.key}`}
            className="mx-5 my-2 rounded-xl border border-border bg-card overflow-hidden"
            style={isReceiving ? { borderColor } : undefined}
        >
            <SprintSectionHeader
                section={section}
                isCollapsed={isCollapsed}
                onToggleCollapsed={onToggleCollapsed}
                actions={headerActions}
            />
            {isReceiving ? <View testID="boards-section-receiving" /> : null}
            <SectionBody
                isVisible={!isCollapsed}
                section={section}
                projectId={projectId}
                canEdit={canEdit}
                isMobile={isMobile}
                registerMeasure={registerMeasure}
                onReceivingChange={setIsReceiving}
            />
        </View>
    )
}

function SectionBody({ isVisible, ...rows }: { isVisible: boolean } & SectionRowsProps) {
    if (!isVisible) return null
    return <SectionRows {...rows} />
}

interface SectionRowsProps {
    section: BacklogSection
    projectId: string
    canEdit: boolean
    isMobile: boolean
    registerMeasure: (key: string, measure: (() => void) | null) => void
    onReceivingChange: (isReceiving: boolean) => void
}

/**
 * The rows, as a drax sortable list registered with the board container
 * under the section's key — so a transfer names the sprint it landed in.
 *
 * The scroll ref never resolves, deliberately: the section is not a scroll
 * container, the page is (useBacklogDnd owns that), and a resolved ref here
 * would make drax auto-scroll the page whenever the pointer neared a short
 * section's edge.
 */
const SectionRows = memo(function SectionRows({
    section,
    projectId,
    canEdit,
    isMobile,
    registerMeasure,
    onReceivingChange,
}: SectionRowsProps) {
    const inertScrollRef = useRef(null)
    const setCardSprint = useSetCardSprint()
    const phantomSpace = useSharedValue(0)
    const cards = sectionCards(section)
    // Keyed by id, never by index: drax renders its OWN stable order for a
    // beat after a drop, so an index into `section.rows` can point past a
    // card that has already left the section.
    const listsByCard = new Map(section.rows.map(row => [row.card.id, row.list]))

    const sortable = useSortableList<BoardCardView>({
        id: section.key,
        data: cards,
        keyExtractor: card => card.id,
        onReorder: event => {
            if (event.fromIndex === event.toIndex) return
            hapticSuccess()
            setCardSprint.mutate({
                cardId: event.fromItem.id,
                sprintId: section.sprint?.id ?? '',
                position: rankForReorder(cards, event.fromItem.id, event.toIndex),
            })
        },
        longPressDelay: CARD_DRAG_ACTIVATION_MS,
        animationConfig: 'snappy',
        inactiveItemStyle: { opacity: 0.75 },
        onDragStart: () => hapticImpactLight(),
    })

    const isForeignCard = (event: DraxMonitorEventData) => {
        const payload = event.dragged.payload
        return isCardDragPayload(payload) && payload.sectionKey !== section.key
    }
    const wasReceivingRef = useRef(false)
    const updateReceiving = (event: DraxMonitorEventData) => {
        const { x, y } = event.monitorOffsetRatio
        const receiving = isForeignCard(event) && x >= 0 && x <= 1 && y >= 0 && y <= 1
        if (receiving !== wasReceivingRef.current) {
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
            scrollRef={inertScrollRef}
            draxViewProps={{
                registration: registration =>
                    registerMeasure(
                        section.key,
                        registration ? () => registration.measure() : null
                    ),
                onMonitorDragEnter: updateReceiving,
                onMonitorDragOver: updateReceiving,
                onMonitorDragExit: clearReceiving,
                onMonitorDragEnd: clearReceiving,
                onMonitorDragDrop: clearReceiving,
            }}
        >
            {/* Room below the last row: drax hit-tests the hovering row's
                centre, so without it a drop aimed just past the last row
                falls outside the section and cancels. */}
            <View style={{ minHeight: 44, paddingBottom: 20 }}>
                <EmptyRows isVisible={cards.length === 0} section={section} />
                {sortable.data.map((card, index) => (
                    <SortableItem
                        key={sortable.stableKeyExtractor(card, index)}
                        sortable={sortable}
                        index={index}
                        payload={{
                            kind: 'boards-card',
                            cardId: card.id,
                            listId: card.listId,
                            sectionKey: section.key,
                        }}
                        hoverDraggingStyle={ROW_HOVER_STYLE}
                        fixed={!canEdit}
                    >
                        <NoNativeDrag>
                            <BacklogRow
                                card={card}
                                list={listsByCard.get(card.id)}
                                projectId={projectId}
                                isMobile={isMobile}
                            />
                        </NoNativeDrag>
                    </SortableItem>
                ))}
                <PhantomSlotSpacer space={phantomSpace} />
            </View>
        </SortableContainer>
    )
})

function EmptyRows({ isVisible, section }: { isVisible: boolean; section: BacklogSection }) {
    if (!isVisible) return null
    const text = section.sprint
        ? 'No cards yet — drag some in from the backlog, or press s on a card.'
        : 'The backlog is empty.'
    return (
        <View className="px-4 py-3">
            <Text className="text-[12.5px] text-muted">{text}</Text>
        </View>
    )
}

/**
 * A row: the table's CardRow, with the focus and selection rings read per
 * row. `list` may be missing for the beat drax still renders a card that
 * has left the section; the card's own category covers the glyph then.
 */
function BacklogRow({
    card,
    list,
    projectId: _projectId,
    isMobile,
}: {
    card: BoardCardView
    list: CardEntry['list'] | undefined
    projectId: string
    isMobile: boolean
}) {
    const isFocused = useBoardsUIStore(s => s.focusedCardId === card.id)
    const isSelected = useBoardsUIStore(s => s.selectedCardIds.has(card.id))
    const select = useCardSelection()
    return (
        <CardRow
            card={card}
            listName={list?.name ?? ''}
            listCategory={list?.category ?? card.listCategory}
            variant={isMobile ? 'stacked' : 'table'}
            isFocused={isFocused}
            isSelected={isSelected}
            onPress={event => select(card.id, event)}
        />
    )
}

function PhantomSlotSpacer({ space }: { space: SharedValue<number> }) {
    const style = useAnimatedStyle(() => ({ height: space.value }))
    return <Reanimated.View style={style} />
}
