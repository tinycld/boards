import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import type { SearchRow } from '@tinycld/core/lib/search/types'
import { useRouter } from 'expo-router'
import { useCardsUIStore } from './stores/cards-ui-store'

interface CardsSearchHit {
    id: string
    title: string
    project: string
    list: string
}

export function toRow(hit: unknown): Omit<SearchRow, 'slug'> | null {
    const card = hit as CardsSearchHit
    return {
        id: card.id,
        title: card.title || 'Untitled card',
        subtitle: undefined,
        meta: undefined,
    }
}

// The palette calls this for every in-scope package while it is open, so it
// only takes handles — no fetching, no subscriptions. The cards UI store has
// no cardId -> projectId map, so selection resolves the card's project by
// reading the already-syncing local collection synchronously via .get() —
// this is a plain lookup into data already in memory, not a live query.
export function useSearchActions() {
    const router = useRouter()
    const orgHref = useOrgHref()
    const [cardsCollection] = useStore('cards_cards')

    return {
        onSelect: (row: SearchRow) => {
            const card = cardsCollection.get(row.id)
            const projectId = card?.project
            if (!projectId) return

            const { setActiveProject, openCard } = useCardsUIStore.getState()

            // The [cardId] screen derives its card from the ROUTE PARAM, not
            // from openCardId, so switching the project underneath it would
            // leave a stale id in the URL rendering "card doesn't exist".
            router.replace(orgHref('cards'))

            // Order matters: setActiveProject deliberately clears openCardId,
            // so opening the card first would immediately undo it. Both are
            // synchronous Zustand set() calls batched into one render.
            setActiveProject(projectId)
            openCard(row.id)
        },
    }
}
