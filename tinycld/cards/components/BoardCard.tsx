import { LabelBadge } from '@tinycld/core/components/LabelBadge'
import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import {
    CalendarDays,
    CircleCheck,
    Clock,
    MessageSquare,
    Paperclip,
    SquareCheck,
} from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import type { RemoteCardsPresence } from '../hooks/useBoardPresence'
import { useCardFileDrop } from '../hooks/useCardFileDrop'
import { dueStateFor, formatDueDate } from '../lib/due-state'
import { useCardsUIStore } from '../stores/cards-ui-store'
import type { BoardCardView, BoardLabel, BoardMember } from '../types'
import { useCardPresence } from './BoardPresenceProvider'

const MAX_LABELS = 3
// Three watchers is already unusual company on one card; past that a count
// says more than another sliver of avatar would. Matches MAX_LABELS so the
// two overflow markers on a card face behave the same way.
const MAX_WATCHERS = 3

interface BoardCardProps {
    card: BoardCardView
    projectId: string
    isDone?: boolean
    /** A grab cursor on a card a viewer cannot drag is a lie — drop it. */
    canDrag: boolean
}

function useCardPress(cardId: string) {
    const openCard = useCardsUIStore(s => s.openCard)
    const isOpen = useCardsUIStore(s => s.openCardId === cardId)
    // Per-card boolean, not the whole focus state: only the card whose ring
    // actually flips re-renders, so arrowing across the board never re-renders
    // a column and cannot disturb a live drag.
    const isFocused = useCardsUIStore(s => s.focusedCardId === cardId)
    const onPress = () => {
        // Releasing a web drag can synthesize a trailing click on whatever
        // sits under the pointer — swallowing it keeps a drop from popping
        // the peek open. Read imperatively: the flag flips mid-gesture, after
        // this closure was registered.
        if (useCardsUIStore.getState().isCardDragging) return
        openCard(cardId)
    }
    return { isOpen, isFocused, onPress }
}

/**
 * The open card already wears the solid ring, so focus only shows while the
 * peek is closed — otherwise the card you are reading carries two rings and
 * neither reads as meaningful. A hovering OS file drop outranks both: it is
 * the only transient state, and the ring is what tells the user which card
 * will receive the files.
 */
function cardRingClass(isOpen: boolean, isFocused: boolean, idle: string, isDropTarget = false) {
    if (isDropTarget) return 'border-ring'
    if (isOpen) return 'border-ring'
    if (isFocused) return 'border-muted-foreground'
    return idle
}

export function BoardCard({ card, projectId, isDone, canDrag }: BoardCardProps) {
    const { isOpen, isFocused, onPress } = useCardPress(card.id)
    // canDrag doubles as the edit gate: both come from the same role check.
    const { isDropTarget, dropRef } = useCardFileDrop(card.id, projectId, canDrag)
    // Board-wide, so read here rather than threaded through BoardColumn —
    // ColumnCards is memoized and deliberately state-free, and a prop would
    // re-render it. Every card face re-renders on toggle, which is fine: it
    // is a deliberate action taken at rest, never mid-drag.
    const isCompact = useCardsUIStore(s => s.isCompactCards)

    if (isDone) {
        return (
            <DoneCard
                cardId={card.id}
                title={card.title}
                isOpen={isOpen}
                isFocused={isFocused}
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
    return (
        <Pressable
            ref={dropRef}
            accessibilityRole="button"
            testID={`board-card-${card.id}`}
            onPress={onPress}
            className={`bg-card border rounded-[10px] shadow-sm ${layout} ${canDrag ? 'web:cursor-grab' : ''} web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring ${cardRingClass(
                isOpen,
                isFocused,
                'border-border hover:border-muted/50',
                isDropTarget
            )}`}
        >
            <DropMarker isDropTarget={isDropTarget} cardId={card.id} />
            <FocusMarker isFocused={isFocused} cardId={card.id} />
            <CardFace card={card} isCompact={isCompact} />
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
function CardFace({ card, isCompact }: { card: BoardCardView; isCompact: boolean }) {
    if (isCompact) {
        return (
            <>
                <CompactLabelDots labels={card.labels ?? []} />
                <Text
                    className="flex-1 text-[13.5px] font-medium leading-[18px] text-foreground"
                    numberOfLines={1}
                >
                    {card.title}
                </Text>
                <CompactDueIcon due={card.due} />
                <CardAssignees assignees={card.assignees} />
            </>
        )
    }
    return (
        <>
            <CardTopRow labels={card.labels ?? []} cardKey={card.key} />
            <Text
                className="text-[13.5px] font-medium leading-[18px] text-foreground"
                numberOfLines={3}
            >
                {card.title}
            </Text>
            <CardMeta card={card} />
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
 * Renders nothing at all when there are no labels AND no key — the case for
 * most cards on a fresh board, which should not carry an empty row.
 */
function CardTopRow({ labels, cardKey }: { labels: BoardLabel[]; cardKey: string }) {
    if (labels.length === 0 && !cardKey) return null
    return (
        <View className="flex-row items-center gap-1">
            <CardLabels labels={labels} />
            <View className="flex-1" />
            <CardKey cardKey={cardKey} />
        </View>
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
            className="text-[10.5px] font-medium tracking-wide text-muted"
            testID="cards-card-key"
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
    return <View testID={`cards-card-dropping-${cardId}`} />
}

/**
 * Zero-size marker the keyboard e2e asserts on — a border class is not
 * queryable. Deliberately NOT prefixed `board-card-`: the e2e helpers select
 * card faces with `[data-testid^="board-card-"]` and read their text, and a
 * second matching node per card would corrupt every column readout.
 */
function FocusMarker({ isFocused, cardId }: { isFocused: boolean; cardId: string }) {
    if (!isFocused) return null
    return <View testID={`cards-focused-${cardId}`} />
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
function CompactDueIcon({ due }: { due?: Date }) {
    const warningColor = useThemeColor('warning')
    const dangerColor = useThemeColor('danger')
    const mutedColor = useThemeColor('muted')
    if (!due) return null

    const state = dueStateFor(due)
    const isOverdue = state === 'overdue'
    const Icon = isOverdue ? Clock : CalendarDays
    const color = isOverdue ? dangerColor : state === 'soon' ? warningColor : mutedColor
    return (
        <View accessibilityLabel={`Due ${formatDueDate(due)}`}>
            <Icon size={12} color={color} strokeWidth={2.2} />
        </View>
    )
}

interface DoneCardProps {
    cardId: string
    title: string
    isOpen: boolean
    isFocused: boolean
    onPress: () => void
    canDrag: boolean
}

function DoneCard({ cardId, title, isOpen, isFocused, onPress, canDrag }: DoneCardProps) {
    const successColor = useThemeColor('success')
    return (
        <Pressable
            accessibilityRole="button"
            testID={`board-card-${cardId}`}
            onPress={onPress}
            className={`bg-card border rounded-[10px] px-3 py-2.5 shadow-sm ${canDrag ? 'web:cursor-grab' : ''} web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring ${cardRingClass(
                isOpen,
                isFocused,
                'border-border'
            )}`}
        >
            <FocusMarker isFocused={isFocused} cardId={cardId} />
            <View className="flex-row items-start gap-2">
                <View className="mt-px">
                    <CircleCheck size={14} color={successColor} strokeWidth={2.4} />
                </View>
                <Text className="flex-1 text-[13.5px] leading-[18px] text-muted" numberOfLines={3}>
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
        <View className="flex-row flex-wrap items-center gap-1">
            {visible.map(label => (
                <LabelBadge key={label.id} name={label.name} color={label.color} />
            ))}
            {overflow > 0 ? (
                <Text className="text-[11px] font-medium text-muted">+{overflow}</Text>
            ) : null}
        </View>
    )
}

function CardMeta({ card }: { card: BoardCardView }) {
    // Presence is read here rather than in BoardCard so it participates in the
    // same row as the other metadata. Per-card, so only the cards a peer moved
    // between re-render.
    const watchers = useCardPresence(card.id)
    const hasPills =
        card.due || card.checklistTotal > 0 || card.commentCount > 0 || card.attachmentCount > 0
    // Someone viewing this card is reason enough to render the row, even on a
    // card that has no other metadata at all.
    if (!hasPills && card.assignees.length === 0 && watchers.length === 0) return null

    return (
        <View className="flex-row items-center gap-2.5 min-h-[20px]">
            <DuePill due={card.due} />
            <ChecklistPill done={card.checklistDone} total={card.checklistTotal} />
            <CommentsPill count={card.commentCount} />
            <AttachmentsPill count={card.attachmentCount} />
            <View className="flex-1" />
            <CardWatchers watchers={watchers} cardId={card.id} />
            <CardAssignees assignees={card.assignees} />
        </View>
    )
}

/**
 * Who is looking at this card right now.
 *
 * Rendered as coloured initials rather than reusing NameAvatar: a watcher is
 * transient and must not read as an assignee, so it carries the peer's own
 * presence colour (stable per user id) and a ring that sets it apart from the
 * assignee stack it sits beside.
 */
function CardWatchers({ watchers, cardId }: { watchers: RemoteCardsPresence[]; cardId: string }) {
    if (watchers.length === 0) return null

    const visible = watchers.slice(0, MAX_WATCHERS)
    const overflow = watchers.length - visible.length
    return (
        <View testID={`cards-watchers-${cardId}`} className="flex-row items-center">
            {visible.map((watcher, index) => (
                <View
                    key={watcher.clientID}
                    accessibilityLabel={`${watcher.user.name} is viewing this card`}
                    className={`w-[18px] h-[18px] rounded-full items-center justify-center border-2 border-card ${index > 0 ? '-ml-1.5' : ''}`}
                    style={{ backgroundColor: watcher.user.color }}
                >
                    <Text className="text-[9px] font-semibold text-white">
                        {watcher.user.name.charAt(0).toUpperCase() || '?'}
                    </Text>
                </View>
            ))}
            {overflow > 0 ? (
                <Text className="text-[10px] font-medium text-muted ml-1">+{overflow}</Text>
            ) : null}
        </View>
    )
}

function DuePill({ due }: { due?: Date }) {
    const warningColor = useThemeColor('warning')
    const dangerColor = useThemeColor('danger')
    const mutedColor = useThemeColor('muted')
    if (!due) return null

    const state = dueStateFor(due)
    const label = formatDueDate(due)
    if (state === 'upcoming') {
        return (
            <View className="flex-row items-center gap-1">
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
            className={`flex-row items-center gap-1 rounded-[5px] px-1.5 py-0.5 -ml-1.5 ${isOverdue ? 'bg-danger/10' : 'bg-warning/10'}`}
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
 * cards_checklist_items syncs on-demand, so the items themselves are not
 * loaded until the card is opened. server/counters.go keeps these current.
 */
function ChecklistPill({ done, total }: { done: number; total: number }) {
    const mutedColor = useThemeColor('muted')
    const successColor = useThemeColor('success')
    if (total === 0) return null

    const isComplete = done === total
    const color = isComplete ? successColor : mutedColor
    return (
        <View className="flex-row items-center gap-1">
            <SquareCheck size={12} color={color} strokeWidth={2.2} />
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
        <View className="flex-row items-center gap-1">
            <MessageSquare size={12} color={mutedColor} strokeWidth={2.2} />
            <Text className="text-[11px] font-medium text-muted">{count}</Text>
        </View>
    )
}

function AttachmentsPill({ count }: { count: number }) {
    const mutedColor = useThemeColor('muted')
    if (!count) return null

    return (
        <View className="flex-row items-center gap-1">
            <Paperclip size={12} color={mutedColor} strokeWidth={2.2} />
            <Text className="text-[11px] font-medium text-muted">{count}</Text>
        </View>
    )
}

function CardAssignees({ assignees }: { assignees: BoardMember[] }) {
    if (assignees.length === 0) return null

    return (
        <View className="flex-row">
            {assignees.map((member, index) => (
                <View
                    key={member.id}
                    className={`rounded-full border-2 border-card ${index > 0 ? '-ml-1.5' : ''}`}
                >
                    <NameAvatar
                        firstName={member.firstName}
                        lastName={member.lastName}
                        size={20}
                        colorKey={member.id}
                    />
                </View>
            ))}
        </View>
    )
}
