import { hexToRgba } from '@tinycld/core/lib/color-utils'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Pressable, Text, View } from 'react-native'
import { useMoveCard } from '../../hooks/useCardMutations'
import { rankForAppend } from '../../lib/move'
import type { BoardCardView, BoardListView, BoardProject } from '../../types'

const SEGMENT_WIDTH = 20
const SEGMENT_HEIGHT = 7

interface ListStepperProps {
    project: BoardProject
    card: BoardCardView
    list: BoardListView
    /**
     * The stepper is the card's status DISPLAY as much as its move control, so
     * a viewer keeps seeing it — the segments just stop being buttons.
     */
    isInteractive: boolean
}

/**
 * The card's position on the board as a row of one-per-list segments, filled
 * through the current list. Pressing a segment moves the card there — the
 * board's list sequence is the card's status, so the control that shows it
 * is the control that changes it.
 */
export function ListStepper({ project, card, list, isInteractive }: ListStepperProps) {
    const moveCard = useMoveCard()
    const successColor = useThemeColor('success')
    const currentIndex = project.lists.findIndex(target => target.id === list.id)

    // The stepper has no drop index — it names a column, not a slot — so a move
    // appends. Pressing the current list is a no-op rather than a re-append to
    // the bottom of the column the card is already in.
    const moveTo = (target: BoardListView) => {
        if (target.id === list.id) return
        moveCard.mutate({
            cardId: card.id,
            listId: target.id,
            position: rankForAppend(target.cards),
        })
    }

    return (
        <View className="flex-row items-center gap-2 shrink min-w-0">
            <View className="flex-row gap-[3px]">
                {project.lists.map((target, index) => (
                    <StepperSegment
                        key={target.id}
                        name={target.name}
                        fillColor={segmentFill(project, list, index, currentIndex, successColor)}
                        borderColor={hexToRgba(project.color, 0.45)}
                        onPress={isInteractive ? () => moveTo(target) : undefined}
                    />
                ))}
            </View>
            <Text className="text-[12.5px] font-semibold text-foreground" numberOfLines={1}>
                {list.name}
            </Text>
        </View>
    )
}

function segmentFill(
    project: BoardProject,
    list: BoardListView,
    index: number,
    currentIndex: number,
    successColor: string
): string | null {
    if (index > currentIndex) return null
    if (list.category === 'done' && index === currentIndex) return successColor
    return project.color
}

interface StepperSegmentProps {
    name: string
    fillColor: string | null
    borderColor: string
    /** Absent when the stepper is display-only — renders a plain View. */
    onPress?: () => void
}

function StepperSegment({ name, fillColor, borderColor, onPress }: StepperSegmentProps) {
    const segmentStyle = {
        width: SEGMENT_WIDTH,
        height: SEGMENT_HEIGHT,
        borderWidth: 1.5,
        borderColor: fillColor ?? borderColor,
        backgroundColor: fillColor ?? 'transparent',
    }

    if (!onPress) {
        return <View className="rounded-[4px]" style={segmentStyle} />
    }

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Move to ${name}`}
            onPress={onPress}
            hitSlop={6}
            className="rounded-[4px] web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            style={segmentStyle}
        />
    )
}
