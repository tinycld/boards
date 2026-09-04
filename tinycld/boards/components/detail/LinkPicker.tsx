import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import { Plus } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useBoardContent, useMemberProjects } from '../../hooks/useActiveBoard'
import { canLinkTo, LINK_LABELS, LINK_TYPES, type LinkType } from '../../lib/card-links'
import type { BoardCardView, BoardsProjects } from '../../types'

interface LinkPickerProps {
    /** The open board's cards — the default candidates, with no fetch needed. */
    cards: BoardCardView[]
    subject: BoardCardView
    /** The board the subject is on, so the board step can default to it. */
    projectId: string
    isPending: boolean
    onSelect: (targetCardId: string, type: LinkType) => void
}

/**
 * Three choices in one affordance: what kind of link, which board, then which
 * card.
 *
 * TYPE FIRST, deliberately. The type changes what the card list MEANS — "which
 * card does this block" and "which card duplicates this" are different
 * questions — and picking the card first would make the second menu feel like
 * a correction rather than a continuation.
 *
 * BOARD SECOND, defaulted to the one you are on. Links may cross boards (a
 * link names two cards and no project), and the section already renders such
 * links correctly; this is the step that lets you FILE one. Defaulting keeps
 * the common same-board case at two clicks — the board row is there to be
 * changed, not to be answered.
 */
export function LinkPicker({ cards, subject, projectId, isPending, onSelect }: LinkPickerProps) {
    const [pendingType, setPendingType] = useState<LinkType | null>(null)
    const [boardId, setBoardId] = useState(projectId)
    const mutedColor = useThemeColor('muted')

    const close = () => {
        setPendingType(null)
        setBoardId(projectId)
    }

    if (pendingType) {
        return (
            <CardChoices
                type={pendingType}
                subject={subject}
                homeCards={cards}
                homeProjectId={projectId}
                boardId={boardId}
                onBoardChange={setBoardId}
                onCancel={close}
                onPick={cardId => {
                    onSelect(cardId, pendingType)
                    close()
                }}
            />
        )
    }

    return (
        <Menu>
            <Menu.Trigger>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add link"
                    testID="boards-link-add"
                    disabled={isPending}
                    className="flex-row items-center gap-2 px-2.5 py-2 rounded-[10px] hover:bg-foreground/5"
                >
                    <Plus size={14} color={mutedColor} strokeWidth={2.2} />
                    <Text className="text-[13px] font-medium text-muted">Add link</Text>
                </Pressable>
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="start">
                    {LINK_TYPES.map(type => (
                        <MenuActionItem
                            key={type}
                            label={LINK_LABELS[type].fromSource}
                            onPress={() => setPendingType(type)}
                        />
                    ))}
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}

interface CardChoicesProps {
    type: LinkType
    subject: BoardCardView
    /** The open board's cards, already loaded — no fetch for the common case. */
    homeCards: BoardCardView[]
    homeProjectId: string
    boardId: string
    onBoardChange: (projectId: string) => void
    onCancel: () => void
    onPick: (cardId: string) => void
}

/**
 * Steps two and three: which board, then which card on it.
 *
 * A plain list rather than a second Menu, because the card set is unbounded
 * where the type set is three — and a board with forty cards in a popover is
 * a scroll trap. Escape-equivalent is the explicit Cancel row, since this is
 * not a menu and has no dismiss of its own.
 */
function CardChoices({
    type,
    subject,
    homeCards,
    homeProjectId,
    boardId,
    onBoardChange,
    onCancel,
    onPick,
}: CardChoicesProps) {
    // MEMBERSHIP, not write access. The create rule is
    // `writerOf(source) && memberOf(target)`, so membership alone qualifies a
    // board as a target — `useWritableProjects` would wrongly hide boards a
    // viewer could legitimately link to. See useMemberProjects.
    const boards = useMemberProjects()
    const isHome = boardId === homeProjectId
    // Only fetched when the chosen board is NOT the open one: the open board's
    // cards are already in hand, and re-reading them would trade a render for
    // a round-trip.
    const { project: farBoard, isLoading } = useBoardContent(isHome ? '' : boardId)

    const farCards = farBoard?.lists.flatMap(list => list.cards) ?? []
    const candidates = (isHome ? homeCards : farCards).filter(card => canLinkTo(card, subject))

    return (
        <View
            className="border border-border rounded-[10px] p-1 mt-1"
            testID="boards-link-card-choices"
        >
            <View className="flex-row items-center justify-between px-2 py-1">
                <Text className="text-[11px] font-medium text-muted">
                    {LINK_LABELS[type].fromSource}…
                </Text>
                <Pressable accessibilityRole="button" onPress={onCancel} className="px-2 py-1">
                    <Text className="text-[11px] text-muted">Cancel</Text>
                </Pressable>
            </View>
            <BoardRow boards={boards} boardId={boardId} onChange={onBoardChange} />
            <CandidateList
                candidates={candidates}
                isHome={isHome}
                isLoading={!isHome && isLoading}
                onPick={onPick}
            />
        </View>
    )
}

/**
 * The board step, as one row that opens a menu — not a list.
 *
 * A row keeps the default visible and one click from being changed, where a
 * second full list would bury the card choices below a board list that is
 * usually answered already.
 */
function BoardRow({
    boards,
    boardId,
    onChange,
}: {
    boards: BoardsProjects[]
    boardId: string
    onChange: (projectId: string) => void
}) {
    const current = boards.find(board => board.id === boardId)
    return (
        <View className="flex-row items-center gap-2 px-2 py-1">
            <Text className="text-[11px] text-muted">on</Text>
            <Menu>
                <Menu.Trigger>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Board: ${current?.name ?? 'this board'}. Change board`}
                        testID="boards-link-board-trigger"
                        className="flex-row items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-foreground/5"
                    >
                        {current?.color ? (
                            <View
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: current.color }}
                            />
                        ) : null}
                        <Text className="text-[11px] font-medium text-foreground">
                            {current?.name ?? 'this board'}
                        </Text>
                    </Pressable>
                </Menu.Trigger>
                <Menu.Portal>
                    <Menu.Overlay />
                    <Menu.Content presentation="popover" placement="bottom" align="start">
                        {boards.map(board => (
                            <MenuActionItem
                                key={board.id}
                                label={board.name}
                                colorDot={board.color}
                                isActive={board.id === boardId}
                                onPress={() => onChange(board.id)}
                            />
                        ))}
                    </Menu.Content>
                </Menu.Portal>
            </Menu>
        </View>
    )
}

/**
 * The cards on the chosen board.
 *
 * LOADING and EMPTY are separate states, and conflating them is the bug this
 * spells out: a far board's cards arrive on demand, so an empty list during
 * the fetch would read as "this board has no cards" — a wrong answer that
 * corrects itself silently a moment later. The same three-state distinction
 * `resolveFarCard` draws in lib/card-links.ts.
 */
function CandidateList({
    candidates,
    isHome,
    isLoading,
    onPick,
}: {
    candidates: BoardCardView[]
    isHome: boolean
    isLoading: boolean
    onPick: (cardId: string) => void
}) {
    if (isLoading) {
        return <Text className="px-2 py-2 text-[12px] text-muted">Loading cards…</Text>
    }
    if (candidates.length === 0) {
        return (
            <Text className="px-2 py-2 text-[12px] text-muted">
                {isHome ? 'No other card on this board yet' : 'No cards on that board yet'}
            </Text>
        )
    }
    return (
        <>
            {candidates.map(card => (
                <Pressable
                    key={card.id}
                    accessibilityRole="button"
                    accessibilityLabel={card.title}
                    testID="boards-link-candidate"
                    onPress={() => onPick(card.id)}
                    className="flex-row items-center gap-2 px-2 py-1.5 rounded hover:bg-foreground/5"
                >
                    {card.key ? (
                        <Text className="text-[11px] font-medium text-muted">{card.key}</Text>
                    ) : null}
                    <Text className="flex-1 text-[13px] text-foreground" numberOfLines={1}>
                        {card.title}
                    </Text>
                </Pressable>
            ))}
        </>
    )
}
