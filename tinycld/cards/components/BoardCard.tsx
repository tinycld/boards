import { LabelBadge } from '@tinycld/core/components/LabelBadge'
import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { CalendarDays, CircleCheck, Clock, MessageSquare, SquareCheck } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { dueStateFor, formatDueDate } from '../lib/due-state'
import { useCardsUIStore } from '../stores/cards-ui-store'
import type { BoardCardView, BoardLabel, BoardMember } from '../types'

const MAX_LABELS = 3

interface BoardCardProps {
    card: BoardCardView
    isDone?: boolean
}

function useCardPress(cardId: string) {
    const openCard = useCardsUIStore(s => s.openCard)
    const isOpen = useCardsUIStore(s => s.openCardId === cardId)
    const onPress = () => {
        // Releasing a web drag can synthesize a trailing click on whatever
        // sits under the pointer — swallowing it keeps a drop from popping
        // the peek open. Read imperatively: the flag flips mid-gesture, after
        // this closure was registered.
        if (useCardsUIStore.getState().isCardDragging) return
        openCard(cardId)
    }
    return { isOpen, onPress }
}

export function BoardCard({ card, isDone }: BoardCardProps) {
    const { isOpen, onPress } = useCardPress(card.id)
    if (isDone) {
        return <DoneCard cardId={card.id} title={card.title} isOpen={isOpen} onPress={onPress} />
    }

    return (
        <Pressable
            accessibilityRole="button"
            testID={`board-card-${card.id}`}
            onPress={onPress}
            className={`bg-card border rounded-[10px] px-3 py-2.5 gap-1.5 shadow-sm web:cursor-grab web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring ${
                isOpen ? 'border-ring' : 'border-border hover:border-muted/50'
            }`}
        >
            <CardLabels labels={card.labels ?? []} />
            <Text
                className="text-[13.5px] font-medium leading-[18px] text-foreground"
                numberOfLines={3}
            >
                {card.title}
            </Text>
            <CardMeta card={card} />
        </Pressable>
    )
}

interface DoneCardProps {
    cardId: string
    title: string
    isOpen: boolean
    onPress: () => void
}

function DoneCard({ cardId, title, isOpen, onPress }: DoneCardProps) {
    const successColor = useThemeColor('success')
    return (
        <Pressable
            accessibilityRole="button"
            testID={`board-card-${cardId}`}
            onPress={onPress}
            className={`bg-card border rounded-[10px] px-3 py-2.5 shadow-sm web:cursor-grab web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring ${
                isOpen ? 'border-ring' : 'border-border'
            }`}
        >
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
    const hasPills = card.due || card.checklistTotal > 0 || card.commentCount > 0
    if (!hasPills && card.assignees.length === 0) return null

    return (
        <View className="flex-row items-center gap-2.5 min-h-[20px]">
            <DuePill due={card.due} />
            <ChecklistPill done={card.checklistDone} total={card.checklistTotal} />
            <CommentsPill count={card.commentCount} />
            <View className="flex-1" />
            <CardAssignees assignees={card.assignees} />
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
