import { Avatar } from '@tinycld/core/components/Avatar'
import { AvatarStack } from '@tinycld/core/components/AvatarStack'
import { LabelBadge } from '@tinycld/core/components/LabelBadge'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ReactionBar } from '@tinycld/core/ui/reactions'
import {
    CalendarDays,
    CircleCheck,
    CircleX,
    Clock,
    Gauge,
    ListTree,
    MessageSquare,
    Paperclip,
    SquareCheck,
} from 'lucide-react-native'
import { type GestureResponderEvent, Pressable, Text, View } from 'react-native'
import type { RemoteCardsPresence } from '../hooks/useBoardPresence'
import { useCardFileDrop } from '../hooks/useCardFileDrop'
import { useCardSelection } from '../hooks/useCardSelection'
import { type AgingLevel, agingLevel } from '../lib/aging'
import { dueStateFor } from '../lib/due-state'
import { formatSchedule } from '../lib/due-time'
import { formatEstimate } from '../lib/estimate'
import { isClosedCategory, type ListCategory } from '../lib/list-category'
import type { CardPriority } from '../lib/priority'
import type { ReactionGroup } from '../lib/reactions'
import { sprintLabel } from '../lib/sprint'
import { subtasksComplete } from '../lib/subtasks'
import { useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardCardView, BoardEpic, BoardLabel, BoardMember, BoardSprint } from '../types'
import { useCardPresence } from './BoardPresenceProvider'
import { PriorityGlyph } from './PriorityGlyph'

const MAX_LABELS = 3

/**
 * The companion to a `shrink` on a flex row child. A flex item's automatic
 * minimum size refuses to go below its content's width, so `flexShrink` alone
 * does nothing and the `numberOfLines={1}` beside it has no bounded width to
 * ellipsize INTO — the same lesson ColumnDragHandle documents in BoardColumn.
 */
const MIN_WIDTH_ZERO = { minWidth: 0 } as const
// Three watchers is already unusual company on one card; past that a count
// says more than another sliver of avatar would. Matches MAX_LABELS so the
// two overflow markers on a card face behave the same way.
const MAX_WATCHERS = 3

// Chips a tile shows before collapsing the rest into a +N marker. Three, like
// the watcher stack beside it: the footer is a scanning aid, not the place to
// read every reaction.
const MAX_TILE_REACTIONS = 3

/** Tighter on the dense face: one row, and the title needs the width. */
const MAX_COMPACT_REACTIONS = 2

/** The compact face's chips never toggle, so the callback is a stable no-op. */
const NO_TOGGLE = () => {}

// The assignee stack collapses at the same count as the watcher stack it sits
// beside, so the two avatar rows on a face overflow identically. Uncapped, a
// card assigned to a whole team was the one item on the meta row that could
// grow without bound and push the row past the card edge.
const MAX_ASSIGNEES = 3

interface BoardCardProps {
    /** From the board-wide reactions query, resolved once per board. */
    reactions: readonly ReactionGroup[]
    /**
     * The board's ONE toggle, resolved in BoardCanvas. Takes the groups it
     * needs rather than reading them, so a tile never subscribes per card.
     */
    onToggleReaction: (cardId: string, emoji: string, groups: readonly ReactionGroup[]) => void
    reactorName: (userId: string) => string
    currentUserId: string
    card: BoardCardView
    projectId: string
    /** The status of the card's list; done and canceled render the closed face. */
    category: ListCategory
    /** A grab cursor on a card a viewer cannot drag is a lie — drop it. */
    canDrag: boolean
    /** The board's aging threshold in days, 0 when off — see lib/aging.ts. */
    agingDays: number
}

function useCardPress(cardId: string) {
    const isOpen = useBoardsUIStore(s => s.openCardId === cardId)
    // Per-card boolean, not the whole focus state: only the card whose ring
    // actually flips re-renders, so arrowing across the board never re-renders
    // a column and cannot disturb a live drag.
    const isFocused = useBoardsUIStore(s => s.focusedCardId === cardId)
    // Per-card for exactly the same reason — a whole-set read here would
    // re-render every column on every toggle.
    const isSelected = useBoardsUIStore(s => s.selectedCardIds.has(cardId))
    // Owns the drag guard and the open-vs-select decision; see the hook.
    const select = useCardSelection()
    const onPress = (event: GestureResponderEvent) => select(cardId, event)
    return { isOpen, isFocused, isSelected, onPress }
}

/**
 * The open card already wears the solid ring, so focus only shows while the
 * peek is closed — otherwise the card you are reading carries two rings and
 * neither reads as meaningful. A hovering OS file drop outranks both: it is
 * the only transient state, and the ring is what tells the user which card
 * will receive the files.
 *
 * Selection sits above focus and below open: a selected card is a stronger
 * statement than the cursor merely resting on one. It is the only rung that
 * also tints the BACKGROUND (see `cardSelectedClass`) rather than only
 * recolouring the border — a selection has to stay legible across a run of
 * cards at a glance, and at most one of them can be the focused one.
 */
function cardRingClass(
    isOpen: boolean,
    isFocused: boolean,
    idle: string,
    isDropTarget = false,
    isSelected = false
) {
    if (isDropTarget) return 'border-ring'
    if (isOpen) return 'border-ring'
    if (isSelected) return 'border-primary'
    if (isFocused) return 'border-muted-foreground'
    return idle
}

/**
 * The card's background: selection first, then how long it has sat still.
 *
 * SELECTION OUTRANKS AGE, which continues the ladder `cardRingClass`
 * documents. A stale tint that could paint over the selection would make a
 * multi-card selection unreadable at exactly the moment it matters — the user
 * is about to act on it — and age is information they can wait a beat for.
 *
 * The soft tokens carry both themes; no raw hex, per the style guide.
 */
function cardSelectedClass(isSelected: boolean, aging: AgingLevel) {
    if (isSelected) return 'bg-primary/10'
    if (aging === 'stale') return 'bg-danger-soft'
    if (aging === 'warm') return 'bg-warning-soft'
    return 'bg-card'
}

export function BoardCard({
    card,
    projectId,
    category,
    canDrag,
    agingDays,
    reactions,
    onToggleReaction,
    reactorName,
    currentUserId,
}: BoardCardProps) {
    const { isOpen, isFocused, isSelected, onPress } = useCardPress(card.id)
    // canDrag doubles as the edit gate: both come from the same role check.
    const { isDropTarget, dropRef } = useCardFileDrop(card.id, projectId, canDrag)
    // Board-wide, so read here rather than threaded through BoardColumn —
    // ColumnCards is memoized and deliberately state-free, and a prop would
    // re-render it. Every card face re-renders on toggle, which is fine: it
    // is a deliberate action taken at rest, never mid-drag.
    const isCompact = useBoardsUIStore(s => s.isCompactCards)

    // Read at render rather than from a ticking clock: the threshold is in
    // DAYS, so a tint that appears on the next board update instead of the
    // exact stroke of midnight is indistinguishable, and a per-card timer
    // across a large board would not be.
    const aging = agingLevel(card.listChangedAt, agingDays, category, new Date())

    if (isClosedCategory(category)) {
        return (
            <ClosedCard
                cardId={card.id}
                title={card.title}
                category={category}
                isOpen={isOpen}
                isFocused={isFocused}
                isSelected={isSelected}
                onPress={onPress}
                canDrag={canDrag}
            />
        )
    }

    // One Pressable for both densities, branching INSIDE. A separate component
    // per density would make the toggle unmount this subtree: the file-drop ref
    // detaches mid-transfer and an in-flight OS drop is lost. Same element type
    // + same hook order = the toggle is a re-render, not a remount.
    const layout = isCompact ? 'px-3 py-1.5 flex-row items-center gap-2' : 'px-3 py-2.5 gap-1.5'
    // NOT accessibilityRole="button": the card CONTAINS buttons (the reaction
    // chips and their picker), and react-native-web renders that role as a real
    // <button> — nesting one inside another is invalid HTML and warns as a
    // hydration error. Mail's EmailRow is the same shape and does the same
    // thing: the row is a plain pressable, the controls inside it are buttons.
    // Keyboard users reach a card through useBoardShortcuts (arrow keys, Enter
    // to open), not native tab order, so the role was never what made this
    // operable — the label below is what a screen reader announces.
    return (
        <Pressable
            ref={dropRef}
            accessibilityLabel={card.title}
            testID={`board-card-${card.id}`}
            onPress={onPress}
            className={`${cardSelectedClass(isSelected, aging)} border rounded-[10px] shadow-sm ${layout} ${canDrag ? 'web:cursor-grab' : ''} web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring ${cardRingClass(
                isOpen,
                isFocused,
                'border-border hover:border-muted/50',
                isDropTarget,
                isSelected
            )}`}
        >
            <DropMarker isDropTarget={isDropTarget} cardId={card.id} />
            <FocusMarker isFocused={isFocused} cardId={card.id} />
            <SelectedMarker isSelected={isSelected} cardId={card.id} />
            <AgingMarker aging={aging} cardId={card.id} />
            <CardFace
                card={card}
                isCompact={isCompact}
                reactions={reactions}
                onToggleReaction={onToggleReaction}
                canReact={canDrag}
                reactorName={reactorName}
                currentUserId={currentUserId}
            />
        </Pressable>
    )
}

/**
 * The part of a card face that differs by density. Kept in one component so the
 * toggle never changes the card root's element type — see the note in BoardCard.
 *
 * The dense face is not a uniformly shrunken card. It keeps what lets someone
 * SCAN a board and drops what belongs to the card detail:
 *
 *   kept    title (one line) and assignees, the two cues you actually search a
 *           board by, plus due state — lateness must never be something you
 *           have to expand a card to see
 *   demoted labels to their colours alone; the colour is the scanning cue and
 *           the word is what costs the room
 *   dropped checklist and comment counts, which nobody scans a board for
 *
 * The done face is already this dense (a check and one line), so it is shared
 * across both densities rather than given a compact variant of its own.
 */
function CardFace({
    card,
    isCompact,
    reactions,
    onToggleReaction,
    canReact,
    reactorName,
    currentUserId,
}: {
    card: BoardCardView
    isCompact: boolean
    reactions: readonly ReactionGroup[]
    onToggleReaction: (cardId: string, emoji: string, groups: readonly ReactionGroup[]) => void
    canReact: boolean
    reactorName: (userId: string) => string
    currentUserId: string
}) {
    if (isCompact) {
        return (
            <>
                <PriorityGlyph priority={card.priority} size={12} />
                <CompactLabelDots labels={card.labels ?? []} />
                <Text
                    testID="boards-card-title"
                    className="flex-1 text-[13.5px] font-medium leading-[18px] text-foreground"
                    numberOfLines={1}
                >
                    {card.title}
                </Text>
                <CompactDueIcon due={card.due} dueHasTime={card.dueHasTime} />
                {/* Read-only here, unlike the standard face. The dense row's
                    contract above is that it keeps what you SCAN a board by and
                    drops the rest — an existing vote is a scanning cue, but the
                    add button is an action, and this row has no width to spend
                    on one. Adding still happens on the standard face or in the
                    open card. Capped tighter than the standard face for the
                    same reason. */}
                <ReactionBar
                    groups={reactions}
                    targetId={card.id}
                    canReact={false}
                    readOnly
                    onToggle={NO_TOGGLE}
                    nameFor={reactorName}
                    currentUserId={currentUserId}
                    maxChips={MAX_COMPACT_REACTIONS}
                    testIDPrefix="boards-tile-reaction"
                />
                <CardAssignees assignees={card.assignees} />
            </>
        )
    }
    return (
        <>
            <CardTopRow
                labels={card.labels ?? []}
                cardKey={card.key}
                priority={card.priority}
                parentKey={card.parentKey}
                epic={card.epic}
                sprint={card.sprint}
            />
            <Text
                testID="boards-card-title"
                className="text-[13.5px] font-medium leading-[18px] text-foreground"
                numberOfLines={3}
            >
                {card.title}
            </Text>
            <CardMeta
                card={card}
                reactions={reactions}
                onToggleReaction={onToggleReaction}
                canReact={canReact}
                reactorName={reactorName}
                currentUserId={currentUserId}
            />
        </>
    )
}

/**
 * Labels and the card key share one row above the title.
 *
 * They are rendered together rather than stacked because the key is a short
 * identifier, not a line of content: on its own row it read as a heading over
 * the title and cost a card face ~16px for four characters. Sharing the row
 * puts it where a label overflow count would sit, and the row survives when
 * either half is missing.
 *
 * The key is pushed RIGHT with a spacer so it lands in a consistent spot down a
 * column, instead of jittering with each card's label widths.
 *
 * Renders nothing at all when there are no labels, no key AND no priority —
 * the case for most cards on a fresh board, which should not carry an empty
 * row. Priority leads the row: it is the one glyph a reader scans a column
 * for, so it sits in the same left-hand spot on every card that has one.
 */
function CardTopRow({
    labels,
    cardKey,
    priority,
    parentKey,
    epic,
    sprint,
}: {
    labels: BoardLabel[]
    cardKey: string
    priority: CardPriority
    parentKey: string
    epic: BoardEpic | null
    sprint: BoardSprint | null
}) {
    if (labels.length === 0 && !cardKey && !parentKey && !epic && !sprint && priority === 'none') {
        return null
    }
    return (
        <View className="flex-row items-center gap-1 overflow-hidden">
            <PriorityGlyph priority={priority} />
            <ParentChip parentKey={parentKey} />
            <EpicChip epic={epic} />
            <SprintChip sprint={sprint} />
            <CardLabels labels={labels} />
            {/* grow-only: as a flex-1 this spacer was the row's ONLY flexible
                item, so it absorbed the entire overflow by collapsing to zero
                and then let the chips run past the card edge. It may take up
                slack; it may not be what yields. */}
            <View className="grow shrink-0 basis-0" />
            <CardKey cardKey={cardKey} />
        </View>
    )
}

/**
 * "↳ OTTER-4" — the card this one is a sub-task of.
 *
 * On the TOP row beside the labels rather than in the meta row, because it
 * identifies the card the way its own key does; a reader scanning a column for
 * "what is this part of" is looking at the same band both keys live in.
 *
 * Renders nothing when the card is top level, and also when the parent has
 * been deleted — `parentKey` is '' in both cases, and a chip pointing at a
 * card that no longer exists is worse than none.
 */
function ParentChip({ parentKey }: { parentKey: string }) {
    if (!parentKey) return null
    return (
        <Text
            testID="boards-parent-chip"
            className="shrink-0 text-[10.5px] font-medium text-muted"
            numberOfLines={1}
        >
            ↳ {parentKey}
        </Text>
    )
}

/**
 * The epic this card is filed under, as a colored dot and its title.
 *
 * On the top row beside the parent chip, for the same reason: both answer
 * "what is this part of", and a reader scanning a column looks in one band for
 * it. Renders nothing for an unfiled card — and for one whose epic has been
 * DELETED, which orphans rather than cascades, so `epic` resolves to null and
 * the card reads as unfiled rather than showing a chip for a row that is gone.
 */
function EpicChip({ epic }: { epic: BoardEpic | null }) {
    if (!epic) return null
    return (
        <View
            className="shrink flex-row items-center gap-[3px]"
            style={MIN_WIDTH_ZERO}
            testID="boards-epic-chip"
        >
            <View
                className="shrink-0 w-[6px] h-[6px] rounded-full"
                style={{ backgroundColor: epic.color || undefined }}
            />
            <Text
                className="shrink text-[10.5px] font-medium text-muted"
                style={MIN_WIDTH_ZERO}
                numberOfLines={1}
            >
                {epic.title}
            </Text>
        </View>
    )
}

/**
 * The sprint this card is in, as its label — "Sprint 4". On the top row
 * beside the epic chip: both say what plan the card belongs to. Nothing for
 * a card in the backlog, or one whose sprint was deleted (null, as a deleted
 * epic is).
 */
function SprintChip({ sprint }: { sprint: BoardSprint | null }) {
    if (!sprint) return null
    return (
        <Text
            testID="boards-sprint-chip"
            className="shrink text-[10.5px] font-medium text-muted"
            style={MIN_WIDTH_ZERO}
            numberOfLines={1}
        >
            {sprintLabel(sprint)}
        </Text>
    )
}

/**
 * The card key — `OTTER-123`.
 *
 * Renders NOTHING when there is no key, and neither case is an error state: a
 * board with no slug, and the beat between an optimistic insert and the server
 * echo that assigns the number (formatCardKey maps both to '' — see
 * lib/card-key.ts).
 *
 * Deliberately not a skeleton for that second case. The gap is one round trip
 * on a local socket, so a placeholder would flicker, and it would imply the key
 * can be SLOW when nothing else on this face makes that claim. The title the
 * user just typed is what they are looking at anyway.
 */
function CardKey({ cardKey }: { cardKey: string }) {
    if (!cardKey) return null
    return (
        <Text
            className="shrink-0 text-[10.5px] font-medium tracking-wide text-muted"
            testID="boards-card-key"
        >
            {cardKey}
        </Text>
    )
}

/**
 * Zero-size marker for the drop-hover state, same rationale as FocusMarker: a
 * border class is not queryable from the e2e, and the `cards-` prefix keeps it
 * out of the `board-card-` face selectors.
 */
function DropMarker({ isDropTarget, cardId }: { isDropTarget: boolean; cardId: string }) {
    if (!isDropTarget) return null
    return <View testID={`boards-card-dropping-${cardId}`} />
}

/**
 * Zero-size marker the keyboard e2e asserts on — a border class is not
 * queryable. Deliberately NOT prefixed `board-card-`: the e2e helpers select
 * card faces with `[data-testid^="board-card-"]` and read their text, and a
 * second matching node per card would corrupt every column readout.
 */
function FocusMarker({ isFocused, cardId }: { isFocused: boolean; cardId: string }) {
    if (!isFocused) return null
    return <View testID={`boards-focused-${cardId}`} />
}

/** The same, for the selection — see FocusMarker for why it is a separate node. */
function SelectedMarker({ isSelected, cardId }: { isSelected: boolean; cardId: string }) {
    if (!isSelected) return null
    return <View testID={`boards-selected-${cardId}`} />
}

/**
 * A zero-size marker naming the card's aging level.
 *
 * The tint is a background colour, and asserting a computed colour in an e2e is
 * brittle in a way that asserting a level is not — the same reason
 * SelectedMarker exists beside it.
 */
function AgingMarker({ aging, cardId }: { aging: AgingLevel; cardId: string }) {
    if (aging === 'fresh') return null
    return <View testID={`boards-card-aging-${aging}-${cardId}`} />
}

/**
 * Label colours without their names, capped and counted exactly as the full
 * face does — a card must not appear to lose labels when density changes, so
 * the overflow marker survives even though the words don't.
 */
function CompactLabelDots({ labels }: { labels: BoardLabel[] }) {
    if (labels.length === 0) return null

    const visible = labels.slice(0, MAX_LABELS)
    const overflow = labels.length - visible.length
    return (
        <View className="flex-row items-center gap-1">
            {visible.map(label => (
                <View
                    key={label.id}
                    accessibilityLabel={label.name}
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: label.color }}
                />
            ))}
            {overflow > 0 ? (
                <Text className="text-[10px] font-medium text-muted">+{overflow}</Text>
            ) : null}
        </View>
    )
}

/**
 * Due state as an icon alone. Keeps the full face's colour semantics — danger
 * for overdue, warning for soon, muted otherwise — because losing the date
 * text must not also lose the fact that something is late.
 */
function CompactDueIcon({ due, dueHasTime }: { due?: Date; dueHasTime: boolean }) {
    const warningColor = useThemeColor('warning')
    const dangerColor = useThemeColor('danger')
    const mutedColor = useThemeColor('muted')
    if (!due) return null

    const state = dueStateFor(due, undefined, dueHasTime)
    const isOverdue = state === 'overdue'
    const Icon = isOverdue ? Clock : CalendarDays
    const color = isOverdue ? dangerColor : state === 'soon' ? warningColor : mutedColor
    return (
        <View accessibilityLabel={`Due ${formatSchedule(undefined, due, dueHasTime)}`}>
            <Icon size={12} color={color} strokeWidth={2.2} />
        </View>
    )
}

interface ClosedCardProps {
    cardId: string
    title: string
    category: ListCategory
    isOpen: boolean
    isFocused: boolean
    isSelected: boolean
    onPress: (event: GestureResponderEvent) => void
    canDrag: boolean
}

/**
 * The face of a card whose work has stopped: a check for done, a cross and a
 * struck title for canceled. Everything else on the face is dropped — the
 * point of a closed column is to be scanned past.
 */
function ClosedCard({
    cardId,
    title,
    category,
    isOpen,
    isFocused,
    isSelected,
    onPress,
    canDrag,
}: ClosedCardProps) {
    const successColor = useThemeColor('success')
    const mutedColor = useThemeColor('muted')
    const isCanceled = category === 'canceled'
    const Icon = isCanceled ? CircleX : CircleCheck
    const iconColor = isCanceled ? mutedColor : successColor
    const titleClass = isCanceled ? 'line-through' : ''
    return (
        <Pressable
            accessibilityRole="button"
            testID={`board-card-${cardId}`}
            onPress={onPress}
            className={`${cardSelectedClass(isSelected, 'fresh')} border rounded-[10px] px-3 py-2.5 shadow-sm ${canDrag ? 'web:cursor-grab' : ''} web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring ${cardRingClass(
                isOpen,
                isFocused,
                'border-border',
                false,
                isSelected
            )}`}
        >
            <FocusMarker isFocused={isFocused} cardId={cardId} />
            <SelectedMarker isSelected={isSelected} cardId={cardId} />
            <View className="flex-row items-start gap-2">
                <View className="mt-px" testID={`boards-card-closed-${cardId}`}>
                    <Icon size={14} color={iconColor} strokeWidth={2.4} />
                </View>
                <Text
                    className={`flex-1 text-[13.5px] leading-[18px] text-muted ${titleClass}`}
                    numberOfLines={3}
                >
                    {title}
                </Text>
            </View>
        </Pressable>
    )
}

function CardLabels({ labels }: { labels: BoardLabel[] }) {
    if (labels.length === 0) return null

    const visible = labels.slice(0, MAX_LABELS)
    const overflow = labels.length - visible.length
    return (
        <View className="shrink flex-row items-center gap-1 overflow-hidden" style={MIN_WIDTH_ZERO}>
            {visible.map(label => (
                <LabelBadge key={label.id} name={label.name} color={label.color} />
            ))}
            {overflow > 0 ? (
                <Text className="shrink-0 text-[11px] font-medium text-muted">+{overflow}</Text>
            ) : null}
        </View>
    )
}

interface CardMetaProps {
    card: BoardCardView
    /**
     * Passed in, NOT read here. Presence below is per-card on purpose, but
     * reactions come from one board-wide query — a per-tile query would be one
     * subscription per card on a board that can hold hundreds.
     */
    reactions: readonly ReactionGroup[]
    onToggleReaction: (cardId: string, emoji: string, groups: readonly ReactionGroup[]) => void
    /** Reacting is an edit — same role gate as dragging. */
    canReact: boolean
    reactorName: (userId: string) => string
    currentUserId: string
}

function CardMeta({
    card,
    reactions,
    onToggleReaction,
    canReact,
    reactorName,
    currentUserId,
}: CardMetaProps) {
    // Presence is read here rather than in BoardCard so it participates in the
    // same row as the other metadata. Per-card, so only the cards a peer moved
    // between re-render.
    const watchers = useCardPresence(card.id)
    const hasPills =
        card.due ||
        card.start ||
        card.checklistTotal > 0 ||
        card.subtaskTotal > 0 ||
        card.commentCount > 0 ||
        card.attachmentCount > 0 ||
        card.estimate !== undefined
    // Someone viewing this card, or a single vote on it, is reason enough to
    // render the row — even on a card with no other metadata at all. So is
    // being ABLE to vote: the row carries the add-reaction button, which is
    // how a card with no reactions yet gets its first one. Without that last
    // clause a fresh card has no way to be reacted to from the board at all.
    const isEmpty =
        !hasPills && card.assignees.length === 0 && watchers.length === 0 && reactions.length === 0
    if (isEmpty && !canReact) return null

    // TWO children, not a flat list of pills. A flat row cannot express what
    // this one needs, because the pills and the people want OPPOSITE things:
    // the pills must stay a tight left cluster (their gaps are what let you
    // scan a column of cards down its left edge — grow or justify them and the
    // gap differs per card), while the people must sit right and, once the row
    // wraps, fill the line they land on.
    //
    // Grouped, each gets its own rule. The pill group hugs; the people group
    // `grow`s, which is per-LINE — alone on a wrapped line it fills the width,
    // and inline it absorbs the slack a `grow` spacer used to. (A spacer cannot
    // survive wrapping at the ROW level: it would eat line one and push the
    // people to line two even when they fit.) Inside the grown box the spacer
    // comes FIRST, which pins everything after it to the right edge.
    //
    // A leading spacer rather than `justify-between` or a spacer between the
    // two, because the watcher and assignee stacks each render nothing when
    // empty: with either of those, a card carrying a vote but nobody on it
    // would fall back to left-aligned chips, so the reaction column would
    // land in a different place depending on whether anyone happened to be
    // assigned. One spacer in front holds that column steady on every card.
    return (
        <View className="flex-row flex-wrap items-center gap-x-2.5 gap-y-1.5 min-h-[20px]">
            <View className="shrink flex-row items-center gap-2.5" style={MIN_WIDTH_ZERO}>
                <SchedulePill start={card.start} due={card.due} dueHasTime={card.dueHasTime} />
                <ChecklistPill done={card.checklistDone} total={card.checklistTotal} />
                <SubtasksPill done={card.subtaskDone} total={card.subtaskTotal} />
                <CommentsPill count={card.commentCount} />
                <AttachmentsPill count={card.attachmentCount} />
                <EstimatePill estimate={card.estimate} />
            </View>
            <View className="grow flex-row items-center gap-2.5">
                <View className="grow shrink basis-0" style={MIN_WIDTH_ZERO} />
                <CardWatchers watchers={watchers} cardId={card.id} />
                <CardAssignees assignees={card.assignees} />
                {/* Capped like the watcher stack so a card with a dozen distinct
                    votes cannot blow out the tile — the open card shows them all. */}
                <ReactionBar
                    groups={reactions}
                    targetId={card.id}
                    canReact={canReact}
                    onToggle={emoji => onToggleReaction(card.id, emoji, reactions)}
                    nameFor={reactorName}
                    currentUserId={currentUserId}
                    maxChips={MAX_TILE_REACTIONS}
                    testIDPrefix="boards-tile-reaction"
                />
            </View>
        </View>
    )
}

/**
 * Who is looking at this card right now.
 *
 * Passes `color` explicitly rather than letting Avatar hash an identity color:
 * a watcher is transient and must not read as an assignee, so it carries the
 * peer's own presence colour (stable per user id) and a ring that sets it
 * apart from the assignee stack it sits beside.
 */
function CardWatchers({ watchers, cardId }: { watchers: RemoteCardsPresence[]; cardId: string }) {
    return (
        <AvatarStack
            testID={`boards-watchers-${cardId}`}
            items={watchers.map(watcher => ({
                key: String(watcher.clientID),
                name: watcher.user.name,
                color: watcher.user.color,
                colorKey: watcher.user.id,
            }))}
            max={MAX_WATCHERS}
            size={18}
            ring="card"
        />
    )
}

/**
 * The schedule on the face: "Sep 10", "Sep 3 → Sep 10", "Sep 10, 2:30 PM"
 * — coloured by the due state, or muted when only a start is set.
 */
function SchedulePill({
    start,
    due,
    dueHasTime,
}: {
    start?: Date
    due?: Date
    dueHasTime: boolean
}) {
    const warningColor = useThemeColor('warning')
    const dangerColor = useThemeColor('danger')
    const mutedColor = useThemeColor('muted')
    if (!due && !start) return null

    const state = due ? dueStateFor(due, undefined, dueHasTime) : 'upcoming'
    const label = formatSchedule(start, due, dueHasTime)
    if (state === 'upcoming') {
        return (
            <View className="shrink-0 flex-row items-center gap-1">
                <CalendarDays size={11} color={mutedColor} strokeWidth={2.2} />
                <Text className="text-[11px] font-medium text-muted">{label}</Text>
            </View>
        )
    }

    const isOverdue = state === 'overdue'
    const Icon = isOverdue ? Clock : CalendarDays
    const color = isOverdue ? dangerColor : warningColor
    return (
        <View
            className={`shrink-0 flex-row items-center gap-1 rounded-[5px] px-1.5 py-0.5 -ml-1.5 ${isOverdue ? 'bg-danger/10' : 'bg-warning/10'}`}
        >
            <Icon size={11} color={color} strokeWidth={2.2} />
            <Text
                className={`text-[11px] font-medium ${isOverdue ? 'text-danger' : 'text-warning'}`}
            >
                {label}
            </Text>
        </View>
    )
}

/**
 * Reads the denormalized counters on the card, not its checklist rows:
 * boards_checklist_items syncs on-demand, so the items themselves are not
 * loaded until the card is opened. server/counters.go keeps these current.
 */
function ChecklistPill({ done, total }: { done: number; total: number }) {
    const mutedColor = useThemeColor('muted')
    const successColor = useThemeColor('success')
    if (total === 0) return null

    const isComplete = done === total
    const color = isComplete ? successColor : mutedColor
    return (
        <View className="shrink-0 flex-row items-center gap-1">
            <SquareCheck size={12} color={color} strokeWidth={2.2} />
            <Text
                className={`text-[11px] font-medium ${isComplete ? 'text-success' : 'text-muted'}`}
            >
                {done}/{total}
            </Text>
        </View>
    )
}

/**
 * The sub-task rollup — "2/5".
 *
 * Reads the denormalized counters for the reason ChecklistPill does, with one
 * difference worth knowing: the children here ARE cards, and cards sync
 * eagerly, so this one could be counted from the loaded board. It is not,
 * because a card face also renders where the board's card set is absent — My
 * cards, search results — and a badge that appears on one surface and not
 * another reads as a bug. server/card_parent.go keeps them current.
 *
 * "Done" is the child's LIST category, not a flag, so this agrees with the
 * list header glyph a reader is looking at.
 */
function SubtasksPill({ done, total }: { done: number; total: number }) {
    const mutedColor = useThemeColor('muted')
    const successColor = useThemeColor('success')
    if (total === 0) return null

    const isComplete = subtasksComplete({ subtaskTotal: total, subtaskDone: done })
    const color = isComplete ? successColor : mutedColor
    return (
        <View className="shrink-0 flex-row items-center gap-1" testID="boards-subtask-pill">
            <ListTree size={12} color={color} strokeWidth={2.2} />
            <Text
                className={`text-[11px] font-medium ${isComplete ? 'text-success' : 'text-muted'}`}
            >
                {done}/{total}
            </Text>
        </View>
    )
}

function CommentsPill({ count }: { count: number }) {
    const mutedColor = useThemeColor('muted')
    if (!count) return null

    return (
        <View className="shrink-0 flex-row items-center gap-1">
            <MessageSquare size={12} color={mutedColor} strokeWidth={2.2} />
            <Text className="text-[11px] font-medium text-muted">{count}</Text>
        </View>
    )
}

function AttachmentsPill({ count }: { count: number }) {
    const mutedColor = useThemeColor('muted')
    if (!count) return null

    return (
        <View className="shrink-0 flex-row items-center gap-1">
            <Paperclip size={12} color={mutedColor} strokeWidth={2.2} />
            <Text className="text-[11px] font-medium text-muted">{count}</Text>
        </View>
    )
}

function EstimatePill({ estimate }: { estimate?: number }) {
    const mutedColor = useThemeColor('muted')
    if (estimate === undefined) return null

    return (
        <View testID="boards-estimate-pill" className="shrink-0 flex-row items-center gap-1">
            <Gauge size={12} color={mutedColor} strokeWidth={2.2} />
            <Text className="text-[11px] font-medium text-muted">{formatEstimate(estimate)}</Text>
        </View>
    )
}

function CardAssignees({ assignees }: { assignees: BoardMember[] }) {
    if (assignees.length === 0) return null

    const visible = assignees.slice(0, MAX_ASSIGNEES)
    const overflow = assignees.length - visible.length
    // Named so a test can assert the face shows assignees without matching on
    // avatar INITIALS, which are one letter and collide with card titles and
    // keys. The watchers row beside it already carries its own testID.
    return (
        <View className="shrink-0 flex-row items-center" testID="boards-card-assignees">
            {visible.map((member, index) => (
                <View
                    key={member.id}
                    className={`rounded-full border-2 border-card ${index > 0 ? '-ml-1.5' : ''}`}
                >
                    <Avatar
                        name={`${member.firstName} ${member.lastName ?? ''}`.trim()}
                        size={20}
                        colorKey={member.id}
                    />
                </View>
            ))}
            {overflow > 0 ? (
                <Text className="text-[10px] font-medium text-muted ml-1">+{overflow}</Text>
            ) : null}
        </View>
    )
}
