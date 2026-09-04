import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Bell, BellOff } from 'lucide-react-native'
import { Pressable, Text } from 'react-native'
import { useCardWatch } from '../../hooks/useCardWatch'
import { useProjectRole } from '../../hooks/useProjectRole'

interface WatchButtonProps {
    projectId: string
    cardId: string
}

/**
 * Follow or unfollow a card, with the count of people following it.
 *
 * Offered to every MEMBER, not just editors — a viewer wanting to hear when a
 * card moves is the common case. Hidden for an anonymous share-link visitor:
 * they hold no membership row, so there is nothing to watch with.
 */
export function WatchButton({ projectId, cardId }: WatchButtonProps) {
    const { role } = useProjectRole(projectId)
    const { isWatching, count, toggle, isPending } = useCardWatch(projectId, cardId)
    const mutedColor = useThemeColor('muted')
    const activeColor = useThemeColor('primary')
    if (role === null) return null

    const label = isWatching ? 'Stop watching card' : 'Watch card'
    const Icon = isWatching ? BellOff : Bell

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: isWatching }}
            testID="boards-watch-button"
            onPress={toggle}
            disabled={isPending}
            className="flex-row items-center gap-1 h-7 px-1.5 rounded-md hover:bg-foreground/10 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            <Icon size={14} color={isWatching ? activeColor : mutedColor} strokeWidth={2.2} />
            {count > 0 ? (
                <Text className="text-[11.5px] font-medium text-muted" testID="boards-watch-count">
                    {count}
                </Text>
            ) : null}
        </Pressable>
    )
}
