import { StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

const WASH_HEIGHT = 320
const WASH_ALPHA = 0.08

/**
 * The board's signature: a faint wash of the project color bleeding down
 * from the header so each project's board is recognizably "its" color
 * without painting any component. Alpha is tuned to read over both the
 * white and near-black backgrounds.
 */
export function ProjectWash({ color }: { color: string }) {
    return (
        <View style={[StyleSheet.absoluteFill, { height: WASH_HEIGHT }]} pointerEvents="none">
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
