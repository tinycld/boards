import { EmptyState } from '@tinycld/core/components/EmptyState'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { Check } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useBoardContent, useWritableProjects } from '../../hooks/useActiveBoard'
import { useMoveCardToBoard } from '../../hooks/useMoveCardToBoard'
import { rankForAppend } from '../../lib/move'
import { remapLabels } from '../../lib/remap-labels'
import type { BoardCardView, BoardProject, CardsProjects } from '../../types'

interface MoveToBoardDialogProps {
    card: BoardCardView
    /** The board the card is on now — excluded from the choices. */
    projectId: string
    isOpen: boolean
    onClose: () => void
    /** Called once the move has landed, to dismiss the card view. */
    onMoved: (result: { boardName: string; key: string }) => void
}

/**
 * Two steps in one dialog: pick a board you can write to, then a list on it.
 * The preview under the list explains what the move changes — labels kept by
 * name, labels dropped, assignees who are not on the target — so nobody is
 * surprised by a card arriving lighter than it left.
 */
export function MoveToBoardDialog(props: MoveToBoardDialogProps) {
    if (!props.isOpen) return null
    return <MoveToBoardDialogBody {...props} />
}

function MoveToBoardDialogBody({ card, projectId, onClose, onMoved }: MoveToBoardDialogProps) {
    const boards = useWritableProjects().filter(project => project.id !== projectId)
    const [targetId, setTargetId] = useState<string>('')
    const [listId, setListId] = useState<string>('')
    // Unset until chosen, deliberately: the server refuses a family move with
    // no answer rather than picking one, so there is no default to preselect.
    const [family, setFamily] = useState<'move' | 'unlink' | ''>('')
    const { project: target } = useBoardContent(targetId)
    const moveCard = useMoveCardToBoard()

    const list = target?.lists.find(l => l.id === listId) ?? target?.lists[0]
    // A card in a family cannot move until the question is answered — the
    // server would refuse it, so the button says so first.
    const hasFamily = card.subtaskTotal > 0 || card.parent !== ''
    const canMove = !!target && !!list && !moveCard.isPending && (!hasFamily || family !== '')

    const confirm = () => {
        if (!target || !list) return
        moveCard.mutate(
            {
                cardId: card.id,
                projectId: target.id,
                listId: list.id,
                position: rankForAppend(list.cards),
                family: family || undefined,
            },
            {
                onSuccess: result => {
                    onClose()
                    onMoved({
                        boardName: target.name,
                        key: result.card.number ? `${target.slug}-${result.card.number}` : '',
                    })
                },
            }
        )
    }

    return (
        <Modal isOpen onClose={onClose}>
            <ModalBackdrop />
            <ModalContent testID="cards-move-board-dialog" className="w-[420px] max-h-[80vh] p-0">
                <View className="px-4 pt-4 pb-2">
                    <Text className="text-[16px] font-semibold text-foreground">
                        Move “{card.title}” to another board
                    </Text>
                </View>
                <ScrollView style={{ maxHeight: 360 }}>
                    <BoardChoices
                        boards={boards}
                        selectedId={targetId}
                        onSelect={id => {
                            setTargetId(id)
                            setListId('')
                        }}
                    />
                    <ListChoices target={target} selectedId={list?.id ?? ''} onSelect={setListId} />
                    <FamilyChoices card={card} selected={family} onSelect={setFamily} />
                    <Preview card={card} target={target} />
                </ScrollView>
                <View className="flex-row gap-3 justify-end p-3 border-t border-border">
                    <Pressable
                        onPress={onClose}
                        className="px-3 py-2"
                        disabled={moveCard.isPending}
                    >
                        <Text className="text-foreground" style={{ fontSize: 13 }}>
                            Cancel
                        </Text>
                    </Pressable>
                    <Button onPress={confirm} isDisabled={!canMove} size="sm">
                        <ButtonText>Move</ButtonText>
                    </Button>
                </View>
            </ModalContent>
        </Modal>
    )
}

function SectionTitle({ children }: { children: string }) {
    return (
        <Text className="text-[10.5px] font-bold uppercase tracking-wide text-muted px-4 pt-2 pb-1">
            {children}
        </Text>
    )
}

function ChoiceRow({
    label,
    color,
    isSelected,
    onPress,
    testID,
}: {
    label: string
    color?: string
    isSelected: boolean
    onPress: () => void
    testID?: string
}) {
    const primaryColor = useThemeColor('primary')
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={label}
            testID={testID}
            onPress={onPress}
            className={`flex-row items-center gap-2 px-4 py-2 hover:bg-foreground/5 ${isSelected ? 'bg-primary/5' : ''}`}
        >
            {color ? (
                <View className="w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: color }} />
            ) : null}
            <Text className="flex-1 text-[13.5px] text-foreground" numberOfLines={1}>
                {label}
            </Text>
            {isSelected ? <Check size={14} color={primaryColor} strokeWidth={2.4} /> : null}
        </Pressable>
    )
}

function BoardChoices({
    boards,
    selectedId,
    onSelect,
}: {
    boards: CardsProjects[]
    selectedId: string
    onSelect: (id: string) => void
}) {
    if (boards.length === 0) {
        return <EmptyState message="No other board you can edit" />
    }
    return (
        <View>
            <SectionTitle>Board</SectionTitle>
            {boards.map(board => (
                <ChoiceRow
                    key={board.id}
                    label={board.name}
                    color={board.color}
                    isSelected={board.id === selectedId}
                    testID={`cards-move-board-${board.id}`}
                    onPress={() => onSelect(board.id)}
                />
            ))}
        </View>
    )
}

function ListChoices({
    target,
    selectedId,
    onSelect,
}: {
    target: BoardProject | null
    selectedId: string
    onSelect: (id: string) => void
}) {
    if (!target) return null
    return (
        <View>
            <SectionTitle>List</SectionTitle>
            {target.lists.map(list => (
                <ChoiceRow
                    key={list.id}
                    label={list.name}
                    isSelected={list.id === selectedId}
                    onPress={() => onSelect(list.id)}
                />
            ))}
        </View>
    )
}

/**
 * What happens to the card's sub-tasks — asked, never assumed.
 *
 * Both answers move work the user cannot see from this dialog: either sub-tasks
 * leave the board they were looking at, or a family they built comes apart. So
 * there is no preselected option and the Move button stays disabled until one
 * is picked, which is also what the server enforces.
 *
 * A card that is itself a SUB-TASK has no choice to offer: its parent cannot
 * follow it across (no cross-board parent is expressible), so the row states
 * that as a fact rather than pretending it is a decision.
 */
function FamilyChoices({
    card,
    selected,
    onSelect,
}: {
    card: BoardCardView
    selected: 'move' | 'unlink' | ''
    onSelect: (choice: 'move' | 'unlink') => void
}) {
    const count = card.subtaskTotal
    if (count === 0 && !card.parent) return null

    return (
        <View>
            <SectionTitle>Sub-tasks</SectionTitle>
            {card.parent ? (
                <Text className="px-4 pb-2 text-[12px] text-muted">
                    This card stops being a sub-task — a parent cannot follow it to another board.
                </Text>
            ) : null}
            {count > 0 ? (
                <>
                    <ChoiceRow
                        label={`Bring ${count === 1 ? 'the sub-task' : `all ${count} sub-tasks`} along`}
                        isSelected={selected === 'move'}
                        testID="cards-move-family-move"
                        onPress={() => onSelect('move')}
                    />
                    <ChoiceRow
                        label={`Leave ${count === 1 ? 'it' : 'them'} here as ${
                            count === 1 ? 'a top-level card' : 'top-level cards'
                        }`}
                        isSelected={selected === 'unlink'}
                        testID="cards-move-family-unlink"
                        onPress={() => onSelect('unlink')}
                    />
                </>
            ) : null}
        </View>
    )
}

/** What changes on arrival: dropped labels, assignees who are not members. */
function Preview({ card, target }: { card: BoardCardView; target: BoardProject | null }) {
    if (!target) return null
    const { dropped } = remapLabels(card.labels, target.labels)
    const memberIds = new Set(target.members.map(m => m.id))
    const leaving = card.assignees.filter(member => !memberIds.has(member.id))
    const lines: string[] = []
    if (dropped.length > 0) {
        lines.push(
            `Labels not on ${target.name} are dropped: ${dropped.map(l => l.name).join(', ')}.`
        )
    }
    if (leaving.length > 0) {
        lines.push(
            `Unassigned on arrival (not members there): ${leaving
                .map(m => `${m.firstName} ${m.lastName}`.trim())
                .join(', ')}.`
        )
    }
    lines.push('The card gets a new key on its new board; the old key stops working.')
    return (
        <View className="px-4 pt-3 pb-2 gap-1">
            {lines.map(line => (
                <Text key={line} className="text-[12px] text-muted">
                    {line}
                </Text>
            ))}
        </View>
    )
}
