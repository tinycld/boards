import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Circle, CircleCheck, CircleDashed, CircleDot, CircleX } from 'lucide-react-native'
import { View } from 'react-native'
import { categoryLabel, type ListCategory } from '../lib/list-category'

interface CategoryGlyphProps {
    category: ListCategory
    size?: number
}

/**
 * One glyph per list status, the PriorityGlyph shape: a dashed circle for
 * backlog, an empty one for to do, a dotted one for in progress, a check for
 * done and a cross for canceled — Linear's vocabulary, which is the one people
 * already read without a legend.
 */
export function CategoryGlyph({ category, size = 12 }: CategoryGlyphProps) {
    const mutedColor = useThemeColor('muted')
    const primaryColor = useThemeColor('primary')
    const successColor = useThemeColor('success')
    const { Icon, color } = glyphFor(category, { mutedColor, primaryColor, successColor })
    return (
        <View
            testID={`boards-list-category-${category}`}
            accessibilityLabel={`Status: ${categoryLabel(category)}`}
        >
            <Icon size={size} color={color} strokeWidth={2.2} />
        </View>
    )
}

function glyphFor(
    category: ListCategory,
    colors: { mutedColor: string; primaryColor: string; successColor: string }
) {
    switch (category) {
        case 'backlog':
            return { Icon: CircleDashed, color: colors.mutedColor }
        case 'todo':
            return { Icon: Circle, color: colors.mutedColor }
        case 'in_progress':
            return { Icon: CircleDot, color: colors.primaryColor }
        case 'done':
            return { Icon: CircleCheck, color: colors.successColor }
        case 'canceled':
            return { Icon: CircleX, color: colors.mutedColor }
    }
}
