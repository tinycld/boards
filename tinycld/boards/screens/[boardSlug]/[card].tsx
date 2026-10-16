import { useLocalSearchParams } from 'expo-router'
import { CardChild } from '../../components/CardChild'
import { paramString } from '../../lib/board-route'

/**
 * A card over its board — `/a/boards/PL/PL-12` (peek), `/a/boards/PL/<id>`
 * (peek, not yet numbered) or `/a/boards/PL/12` (full page). See CardChild.
 */
export default function CardChildScreen() {
    const params = useLocalSearchParams<{ card?: string }>()
    return <CardChild segment={paramString(params.card)} />
}
