import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { OctagonAlert, SignalHigh, SignalLow, SignalMedium } from 'lucide-react-native'
import { View } from 'react-native'
import { type CardPriority, priorityLabel } from '../lib/priority'

interface PriorityGlyphProps {
    priority: CardPriority
    size?: number
}

/**
 * One glyph per priority, the same on the board face, the compact face, the
 * detail chip and the picker — so a reader learns four shapes once.
 *
 * Linear's signal bars rather than Jira's arrows: the bars read as a scale at
 * a glance (more bars, more urgent), where an arrow needs the colour to say
 * which way is up. Urgent breaks the pattern deliberately: it is not "four
 * bars", it is an alarm, and the octagon is what stops it reading as merely
 * one step above high.
 *
 * `none` renders NOTHING rather than a hollow shape. Most cards on most
 * boards have no priority, and a face carrying an empty-priority marker on
 * every one of them would turn the absence into noise.
 */
export function PriorityGlyph({ priority, size = 13 }: PriorityGlyphProps) {
    const dangerColor = useThemeColor('danger')
    const warningColor = useThemeColor('warning')
    const mutedColor = useThemeColor('muted')
    if (priority === 'none') return null

    const Icon = GLYPHS[priority]
    const color =
        priority === 'urgent' ? dangerColor : priority === 'high' ? warningColor : mutedColor
    return (
        <View
            accessibilityLabel={`Priority: ${priorityLabel(priority)}`}
            testID={`cards-priority-${priority}`}
        >
            <Icon size={size} color={color} strokeWidth={2.4} />
        </View>
    )
}

const GLYPHS = {
    urgent: OctagonAlert,
    high: SignalHigh,
    medium: SignalMedium,
    low: SignalLow,
} as const
