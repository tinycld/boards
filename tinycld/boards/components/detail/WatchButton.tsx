import type { ToolbarItem } from '@tinycld/core/components/ResponsiveToolbar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import type { LucideIcon } from 'lucide-react-native'
import { Bell, BellOff } from 'lucide-react-native'
import { Pressable, Text } from 'react-native'
import { useCardWatch } from '../../hooks/useCardWatch'
import { useProjectRole } from '../../hooks/useProjectRole'

/**
 * Follow or unfollow a card, as a header toolbar item: the bell with the count
 * of people following in the row, and the same toggle as a menu row once the
 * header folds.
 *
 * Offered to every MEMBER, not just editors — a viewer wanting to hear when a
 * card moves is the common case. Null for an anonymous share-link visitor:
 * they hold no membership row, so there is nothing to watch with.
 */
export function useWatchToolbarItem(projectId: string, cardId: string): ToolbarItem | null {
    const { role } = useProjectRole(projectId)
    const { isWatching, count, toggle, isPending } = useCardWatch(projectId, cardId)
    if (role === null) return null

    const label = isWatching ? 'Stop watching card' : 'Watch card'
    const icon = isWatching ? BellOff : Bell
    return {
        type: 'custom',
        key: 'watch',
        element: (
            <WatchButton
                label={label}
                icon={icon}
                isWatching={isWatching}
                count={count}
                onPress={toggle}
                isPending={isPending}
            />
        ),
        overflow: { label, icon, onPress: toggle },
    }
}

interface WatchButtonProps {
    label: string
    icon: LucideIcon
    isWatching: boolean
    count: number
    onPress: () => void
    isPending: boolean
}

function WatchButton({
    label,
    icon: Icon,
    isWatching,
    count,
    onPress,
    isPending,
}: WatchButtonProps) {
    const mutedColor = useThemeColor('muted')
    const activeColor = useThemeColor('primary')
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: isWatching }}
            testID="boards-watch-button"
            onPress={onPress}
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
