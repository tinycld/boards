import { useLocalSearchParams } from 'expo-router'
import { useMemo } from 'react'
import { flattenCards } from '../lib/board-cards'
import { paramString, parseCardSegment } from '../lib/board-route'
import type { BoardProject } from '../types'
import { useBoardLayout } from './useBoardLayout'

/** A card on screen over the board, and which surface it is on. */
export type OpenCard = { cardId: string; surface: 'peek' | 'page' } | null

/**
 * The card this route's `[card]` segment names, resolved on THIS board; null
 * on the index child and for a segment that names nothing here.
 *
 * Read from the route's own param, so a child covered by another keeps
 * resolving its own card rather than the one on top of it.
 */
export function useOpenCard(): OpenCard {
    const { project } = useBoardLayout()
    const params = useLocalSearchParams<{ card?: string }>()
    const segment = paramString(params.card)
    return useMemo(() => resolveOpenCard(project, segment), [project, segment])
}

/**
 * A `[card]` segment -> the card it names on `project`.
 *
 * A key must carry this board's slug, so `OTTER-2` on the PL board is nothing
 * rather than whichever card happens to be numbered 2 here. A bare number is
 * the full page; a key or a record id is the peek (or the modal — the surface
 * between those two is the reader's preference, not the URL's).
 */
export function resolveOpenCard(project: BoardProject, segment: string): OpenCard {
    const parsed = parseCardSegment(segment)
    if (parsed.kind === 'none') return null
    if (parsed.kind === 'key' && parsed.slug !== project.slug.toUpperCase()) return null
    for (const { card } of flattenCards(project)) {
        if (parsed.kind === 'key' && card.number === parsed.number) {
            return { cardId: card.id, surface: 'peek' }
        }
        if (parsed.kind === 'id' && card.id === parsed.id) {
            return { cardId: card.id, surface: 'peek' }
        }
        if (parsed.kind === 'number' && card.number === parsed.number) {
            return { cardId: card.id, surface: 'page' }
        }
    }
    return null
}
