import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { CircleCheck, CircleDashed } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { useCreateCard } from '../../hooks/useCardMutations'
import { isClosedCategory } from '../../lib/list-category'
import { rankForAppend } from '../../lib/move'
import { childrenOf } from '../../lib/subtasks'
import { useCardsUIStore } from '../../stores/cards-ui-store'
import type { BoardCardView } from '../../types'
import { CardComposer } from '../CardComposer'

interface DetailSubtasksProps {
    card: BoardCardView
    /** Every card on the board — the section picks its own children out. */
    projectCards: BoardCardView[]
    projectId: string
    canEdit: boolean
}

/**
 * The card's sub-tasks: what they are, and how to add one.
 *
 * Sub-tasks are ORDINARY CARDS that name a parent, so a row here is a link to
 * a real card rather than an inline-editable item — which is the visible
 * difference from the checklist above it. A checklist item is a tick-box that
 * lives on this card; a sub-task has its own key, assignee, dates and history,
 * and pressing a row opens it. That is also why there is no rename affordance
 * and no drag handle: both belong to the card the row points at.
 *
 * A new sub-task lands in the PARENT'S OWN LIST. The alternative — the board's
 * first list — puts new work somewhere the person filing it is not looking,
 * and the same-board invariant makes the parent's list the only choice that
 * needs no picker.
 */
export function DetailSubtasks({ card, projectCards, projectId, canEdit }: DetailSubtasksProps) {
    const createCard = useCreateCard(projectId)
    const children = childrenOf(projectCards, card)

    // A sub-task cannot itself have sub-tasks (server/card_parent.go caps the
    // depth at one level), so an open child shows no section at all rather
    // than an empty one that could never be filled.
    if (card.parent) return null
    // Like the checklist: the section normally always renders because it owns
    // the composer, so with no composer an empty list is a heading over
    // nothing.
    if (!canEdit && children.length === 0) return null

    // Ranked against the parent's own column, which is where the new sub-task
    // lands. Derived from projectCards rather than taking the list as a prop:
    // the section already holds every card on the board, and a BoardListView
    // would be a second source for the same array.
    const addSubtask = (title: string) =>
        createCard.mutate({
            listId: card.listId,
            title,
            position: rankForAppend(projectCards.filter(c => c.listId === card.listId)),
            parent: card.id,
        })

    return (
        <View className="mb-6">
            <View className="flex-row items-center gap-2 mb-2.5">
                <Text className="text-[13px] font-semibold text-foreground">Sub-tasks</Text>
                {card.subtaskTotal > 0 ? (
                    <Text className="text-[12px] font-medium text-muted">
                        {card.subtaskDone}/{card.subtaskTotal}
                    </Text>
                ) : null}
            </View>
            {children.map(child => (
                <SubtaskRow key={child.id} card={child} />
            ))}
            {canEdit ? (
                <CardComposer
                    onSubmit={addSubtask}
                    isPending={createCard.isPending}
                    label="Add sub-task"
                    placeholder="What needs doing?"
                />
            ) : null}
        </View>
    )
}

/**
 * One sub-task: its status, key and title, as a link to the card itself.
 *
 * The tick is READ-ONLY, deliberately. A sub-task is completed by moving it to
 * a done list — that is what `subtask_done` counts and what the list header
 * glyph shows — so a checkbox here would have to invent a destination list and
 * would disagree with the board the moment someone picked a different one.
 */
function SubtaskRow({ card }: { card: BoardCardView }) {
    const openCard = useCardsUIStore(s => s.openCard)
    const mutedColor = useThemeColor('muted')
    const successColor = useThemeColor('success')
    const isDone = isClosedCategory(card.listCategory)

    return (
        <Pressable
            testID="cards-subtask-row"
            onPress={() => openCard(card.id)}
            className="flex-row items-center gap-2 py-1.5 active:opacity-60"
        >
            {isDone ? (
                <CircleCheck size={14} color={successColor} strokeWidth={2.2} />
            ) : (
                <CircleDashed size={14} color={mutedColor} strokeWidth={2.2} />
            )}
            {card.key ? (
                <Text className="text-[11px] font-medium text-muted">{card.key}</Text>
            ) : null}
            <Text
                className={`flex-1 text-[13px] ${isDone ? 'text-muted line-through' : 'text-foreground'}`}
                numberOfLines={1}
            >
                {card.title}
            </Text>
        </Pressable>
    )
}
