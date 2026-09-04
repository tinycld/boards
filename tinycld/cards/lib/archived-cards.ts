// The archived-items panel's rows, assembled from the flat records.
//
// Pure, like board-project.ts, so the ordering can be tested without React —
// and so the "PocketBase says '' where the UI wants nothing" conversions live
// in one place.

import type { CardsCards } from '../types'
import { formatCardKey } from './card-key'

export interface ArchivedCardRow {
    id: string
    /** `OTTER-12`, or '' for a board with no slug. */
    key: string
    title: string
    /** The column the card will return to on restore; '' when that list is gone. */
    listName: string
    /**
     * ISO timestamp from `archived_at`, '' for a row the server never stamped
     * (archived before the column existed and missed by the backfill, which is
     * only possible for a card archived and never touched since).
     */
    archivedAt: string
}

interface ListLike {
    id: string
    name: string
}

/**
 * Archived cards, most recently archived first.
 *
 * Only archived rows are considered — callers may pass the whole board — and
 * an unstamped row sorts LAST, after every dated one: it is the oldest thing
 * in the panel by construction, and putting it first would present the one
 * row with no date as the freshest.
 */
export function buildArchivedCards(
    cards: CardsCards[],
    lists: ListLike[],
    projectSlug: string
): ArchivedCardRow[] {
    const listNames = new Map(lists.map(list => [list.id, list.name]))
    return cards
        .filter(card => card.archived)
        .map(card => ({
            id: card.id,
            key: formatCardKey(projectSlug, card.number),
            title: card.title,
            listName: listNames.get(card.list) ?? '',
            archivedAt: card.archived_at,
        }))
        .sort(byArchivedDesc)
}

function byArchivedDesc(a: ArchivedCardRow, b: ArchivedCardRow): number {
    if (a.archivedAt !== b.archivedAt) {
        if (a.archivedAt === '') return 1
        if (b.archivedAt === '') return -1
        return a.archivedAt < b.archivedAt ? 1 : -1
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
