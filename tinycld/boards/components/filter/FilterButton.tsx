import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ListFilter } from 'lucide-react-native'
import { forwardRef } from 'react'
import { Pressable, Text, View } from 'react-native'

interface FilterButtonProps {
    activeCount: number
    onPress?: () => void
}

/**
 * The filter entry point, for every role — a view preference, like density.
 * The badge counts FACETS, not hidden cards: "2" means two kinds of
 * constraint are on, which is what someone wondering "why is the board
 * half-empty" needs to know first.
 *
 * forwardRef + optional onPress because it doubles as a Menu.Trigger child on
 * wide screens, where the trigger clones it to inject both.
 */
export const FilterButton = forwardRef<View, FilterButtonProps>(function FilterButton(
    { activeCount, onPress },
    ref
) {
    const mutedColor = useThemeColor('muted')
    const activeColor = useThemeColor('primary')
    const isActive = activeCount > 0

    return (
        <Pressable
            ref={ref}
            accessibilityRole="button"
            accessibilityLabel={isActive ? `Filter cards (${activeCount} active)` : 'Filter cards'}
            testID="boards-filter-button"
            onPress={onPress}
            className="flex-row items-center gap-1 h-7 px-1.5 rounded-md hover:bg-foreground/10 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            <ListFilter size={15} color={isActive ? activeColor : mutedColor} strokeWidth={2} />
            {isActive ? (
                <View className="bg-primary rounded-full min-w-[16px] h-4 px-1 items-center justify-center">
                    <Text className="text-[10px] font-bold text-primary-foreground">
                        {activeCount}
                    </Text>
                </View>
            ) : null}
        </Pressable>
    )
})
