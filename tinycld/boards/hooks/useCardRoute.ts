import { eq } from '@tanstack/db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useMemo } from 'react'
import { parseCardKey } from '../lib/card-key'
import { useBoardsUIStore } from '../stores/boards-ui-store'
import { useBoardContent } from './useActiveBoard'
import { useBoardLiveQuery } from './useBoardLiveQuery'

/**
 * Resolve a `/boards/<param>` route segment to a board and a card id.
 *
 * The segment is EITHER a raw record id — every link minted before keys
 * existed, and every router.push the board itself makes — or a key like
 * OTTER-123. parseCardKey tells them apart without a try/catch: a 15-character
 * PocketBase id has no hyphen and simply does not parse.
 *
 * WHY THIS DOES NOT GO THROUGH useActiveBoard. That hook resolves the board
 * from the Zustand store, so a card on any OTHER board rendered "this card
 * doesn't exist" — a bug that predates keys and affects plain id links too. The
 * obvious fix, switching the active board once the card resolves elsewhere, is
 * an effect that writes state during render (which CLAUDE.md rules out) and it
 * would also fight the store: setActiveProject clears openCardId, closing a peek
 * the reader had open on the board they were actually looking at.
 *
 * So the route touches the store only as a fallback, and never writes it. It
 * derives a project id from the param and hands that to useBoardContent — the
 * same by-id hook the public share-link screen uses. Opening a card by key
 * therefore READS another board without SWITCHING to it, which is also the
 * better behavior: following a link out of a chat message should not silently
 * rearrange the sidebar you come back to.
 */
export function useCardRoute(param: string) {
    const [cardsCollection, projectsCollection] = useStore('boards_cards', 'boards_projects')
    const activeProjectId = useBoardsUIStore(s => s.activeProjectId)

    const key = useMemo(() => parseCardKey(param), [param])

    // THE KEY PATH, step 1: slug -> project id. Two queries rather than a join
    // because the filter is on a scalar the card does not carry, so there is no
    // single equality to join on until the project id is known.
    const { data: slugRows, isLoading: slugLoading } = useBoardLiveQuery(
        query => {
            if (!key) return null
            return query
                .from({ project: projectsCollection })
                .where(({ project }) => eq(project.slug, key.slug))
        },
        [key?.slug, projectsCollection]
    )
    const keyProjectId = slugRows?.[0]?.id ?? ''

    // Step 2: the board's cards, so the number can be matched to a record id.
    const { data: numberRows, isLoading: numberLoading } = useBoardLiveQuery(
        query => {
            if (!key || !keyProjectId) return null
            return query
                .from({ card: cardsCollection })
                .where(({ card }) => eq(card.project, keyProjectId))
        },
        [key?.slug, keyProjectId, cardsCollection]
    )

    // THE ID PATH. boards_cards syncs eagerly (collections.ts), so this is a
    // synchronous lookup into the local store — the same .get() the search
    // adapter uses — not a query. Resolving the card's OWN project is what
    // makes a deep link to a card on a non-active board work for plain ids too,
    // not just for keys. Falls back to the stored active board only while the
    // card has not synced, so the loading branch still has a board to wait on.
    const idProjectId = key ? '' : (cardsCollection.get(param)?.project ?? activeProjectId ?? '')

    const projectId = key ? keyProjectId : idProjectId
    const { project, isLoading: contentLoading } = useBoardContent(projectId)

    // The key path resolves to a RECORD ID here, so everything downstream —
    // findCardEntry, the presence room, the j/k stepper — keeps working on ids
    // and never learns that keys exist.
    const cardId = useMemo(() => {
        if (!key) return param
        return (numberRows ?? []).find(row => row.number === key.number)?.id ?? ''
    }, [key, numberRows, param])

    return {
        project,
        cardId,
        // A key needs its two lookups to settle before "no such card" can be
        // true; without them a deep link flashes the not-found state on every
        // cold load, which is the same trap the isLoading check on the card
        // screen already guards for the id path.
        isLoading: contentLoading || (key ? slugLoading || numberLoading : false),
    }
}
