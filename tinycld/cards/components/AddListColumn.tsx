import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Plus } from 'lucide-react-native'
import { Pressable, Text } from 'react-native'
import { COLUMN_WIDTH } from './BoardColumn'

export function AddListColumn() {
    const mutedColor = useThemeColor('muted')
    return (
        <Pressable
            accessibilityRole="button"
            className="flex-row items-center gap-2 border-[1.5px] border-dashed border-foreground/15 rounded-[14px] px-4 py-3.5 hover:bg-foreground/5 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            style={{ width: COLUMN_WIDTH }}
        >
            <Plus size={14} color={mutedColor} strokeWidth={2.2} />
            <Text className="text-[13px] font-medium text-muted">Add list</Text>
        </Pressable>
    )
}
