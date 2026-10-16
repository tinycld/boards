import { useLocalSearchParams } from 'expo-router'
import { CardChild } from '../../components/CardChild'
import { useOptionalBoardLayout } from '../../hooks/useBoardLayout'
import { paramString } from '../../lib/board-route'

/**
 * A card over its board — `/a/boards/PL/PL-12` (peek), `/a/boards/PL/<id>`
 * (peek, not yet numbered) or `/a/boards/PL/12` (full page). See CardChild.
 *
 * Draws nothing while the layout has no board: loading, not found, or parked
 * under another screen. The route stays, so the card comes back with its board.
 */
export default function CardChildScreen() {
    const params = useLocalSearchParams<{ card?: string }>()
    const layout = useOptionalBoardLayout()
    if (!layout) return null
    return <CardChild segment={paramString(params.card)} />
}
