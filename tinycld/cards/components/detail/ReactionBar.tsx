import { Pressable, Text, View } from 'react-native'
import {
    REACTION_KEYS,
    REACTION_LABELS,
    type ReactionEmoji,
    type ReactionGroup,
} from '../../lib/reactions'
import { ReactionPicker } from './ReactionPicker'

interface ReactionBarProps {
    commentId: string
    groups: ReactionGroup[]
    /** viaCommenter — a viewer sees the chips but cannot add or remove one. */
    canReact: boolean
    onToggle: (emoji: ReactionEmoji) => void
}

/**
 * The row of emoji chips under a comment, plus the picker. One chip per
 * emoji anyone has used, the caller's own tinted; pressing a chip toggles
 * the caller's reaction, pressing the smiley opens the picker. Nothing at
 * all when there is nothing to show and nothing the reader could add.
 */
export function ReactionBar({ commentId, groups, canReact, onToggle }: ReactionBarProps) {
    if (groups.length === 0 && !canReact) return null
    return (
        <View className="flex-row flex-wrap items-center gap-1 mt-1.5">
            {groups.map(group => (
                <ReactionChip
                    key={group.emoji}
                    commentId={commentId}
                    group={group}
                    canReact={canReact}
                    onPress={() => onToggle(group.emoji)}
                />
            ))}
            <PickerSlot isVisible={canReact} onPick={onToggle} />
        </View>
    )
}

function ReactionChip({
    commentId,
    group,
    canReact,
    onPress,
}: {
    commentId: string
    group: ReactionGroup
    canReact: boolean
    onPress: () => void
}) {
    const isOwn = group.ownId !== null
    const tint = isOwn
        ? 'bg-primary/10 border-primary/40'
        : 'bg-foreground/[0.06] border-transparent'
    const label = `${REACTION_LABELS[group.emoji]} ${group.count}`
    const testID = `cards-reaction-${commentId}-${REACTION_KEYS[group.emoji]}`
    const content = (
        <>
            <Text className="text-[12px]">{group.emoji}</Text>
            <Text className={`text-[11.5px] font-medium ${isOwn ? 'text-primary' : 'text-muted'}`}>
                {group.count}
            </Text>
        </>
    )
    if (!canReact) {
        return (
            <View
                accessibilityLabel={label}
                testID={testID}
                className={`flex-row items-center gap-1 rounded-full border px-2 py-[2px] ${tint}`}
            >
                {content}
            </View>
        )
    }
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: isOwn }}
            accessibilityLabel={label}
            testID={testID}
            onPress={onPress}
            className={`flex-row items-center gap-1 rounded-full border px-2 py-[2px] web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring ${tint}`}
        >
            {content}
        </Pressable>
    )
}

function PickerSlot({
    isVisible,
    onPick,
}: {
    isVisible: boolean
    onPick: (emoji: ReactionEmoji) => void
}) {
    if (!isVisible) return null
    return <ReactionPicker onPick={onPick} />
}
