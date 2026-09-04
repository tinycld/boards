import { View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

const WASH_HEIGHT = 320
const WASH_ALPHA = 0.08

interface ProjectWashProps {
    color: string
    height?: number
    /**
     * Extra width painted past the container's right edge, into the
     * safe-area gutter the workspace pane insets on the housing side in
     * landscape. Backgrounds are supposed to run edge to edge with only
     * content inset; without the bleed the wash stops at the padding edge
     * and a band of plain app background shows beside it. Pass
     * `useDeviceInsets().right` — side-corrected, so it is 0 everywhere a
     * bleed would be wrong.
     */
    bleedRight?: number
}

/**
 * The board's signature: a faint wash of the project color bleeding down
 * from the header so each project's board is recognizably "its" color
 * without painting any component. Alpha is tuned to read over both the
 * white and near-black backgrounds.
 */
export function ProjectWash({ color, height = WASH_HEIGHT, bleedRight = 0 }: ProjectWashProps) {
    return (
        <View
            style={{ position: 'absolute', top: 0, left: 0, right: -bleedRight, height }}
            pointerEvents="none"
        >
            <Svg width="100%" height="100%">
                <Defs>
                    <LinearGradient id="project-wash" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor={color} stopOpacity={WASH_ALPHA} />
                        <Stop offset="1" stopColor={color} stopOpacity={0} />
                    </LinearGradient>
                </Defs>
                <Rect width="100%" height="100%" fill="url(#project-wash)" />
            </Svg>
        </View>
    )
}
