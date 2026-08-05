import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Columns3, Plus } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { useCardsUIStore } from '../stores/cards-ui-store'

function EmptyState({
    title,
    body,
    actionLabel,
    onPress,
}: {
    title: string
    body: string
    actionLabel: string
    onPress?: () => void
}) {
    const mutedColor = useThemeColor('muted')
    return (
        <View className="flex-1 items-center justify-center gap-2 p-8">
            <Columns3 size={28} color={mutedColor} strokeWidth={1.6} />
            <Text className="text-[15px] font-semibold text-foreground mt-1">{title}</Text>
            <Text className="text-[13px] text-muted text-center">{body}</Text>
            <Pressable
                accessibilityRole="button"
                onPress={onPress}
                className="flex-row items-center gap-2 border-[1.5px] border-dashed border-foreground/15 rounded-[10px] px-4 py-2 mt-3 hover:bg-foreground/5 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                <Plus size={14} color={mutedColor} strokeWidth={2.2} />
                <Text className="text-[13px] font-medium text-muted">{actionLabel}</Text>
            </Pressable>
        </View>
    )
}

/**
 * What a member sees before they have any board at all — the first-run screen,
 * and the only place a brand-new workspace offers a way forward.
 */
export function NoBoards() {
    const openNewBoard = useCardsUIStore(s => s.openNewBoard)
    return (
        <EmptyState
            title="No boards yet"
            body="Create a board to start tracking work."
            actionLabel="New board"
            onPress={openNewBoard}
        />
    )
}

/** A board that exists but has no columns. */
export function EmptyBoard() {
    return (
        <EmptyState
            title="No lists yet"
            body="Create a list to start adding cards."
            actionLabel="Add list"
        />
    )
}
