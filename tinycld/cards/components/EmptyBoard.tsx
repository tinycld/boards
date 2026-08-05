import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Columns3, Plus } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'

export function EmptyBoard() {
    const mutedColor = useThemeColor('muted')
    return (
        <View className="flex-1 items-center justify-center gap-2 p-8">
            <Columns3 size={28} color={mutedColor} strokeWidth={1.6} />
            <Text className="text-[15px] font-semibold text-foreground mt-1">No lists yet</Text>
            <Text className="text-[13px] text-muted text-center">
                Create a list to start adding cards.
            </Text>
            <Pressable
                accessibilityRole="button"
                className="flex-row items-center gap-2 border-[1.5px] border-dashed border-foreground/15 rounded-[10px] px-4 py-2 mt-3 hover:bg-foreground/5 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                <Plus size={14} color={mutedColor} strokeWidth={2.2} />
                <Text className="text-[13px] font-medium text-muted">Add list</Text>
            </Pressable>
        </View>
    )
}
