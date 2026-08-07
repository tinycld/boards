import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import type { SearchRow } from '@tinycld/core/lib/search/types'
import { useToastStore } from '@tinycld/core/lib/stores/toast-store'
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
            if (!projectId) {
                // toRow is pure — it cannot reach cardsCollection to skip an
                // unresolvable hit before it ever renders as selectable — so
                // this guard has to live here. Silently returning made
                // pressing Enter indistinguishable from a broken feature: the
                // palette still closes (SearchPalette only skips the close
                // when NO handler ran at all, not when a handler ran and
                // declined). A toast at least tells the user why nothing
                // happened instead of leaving them to assume the app is
                // broken.
                useToastStore.getState().addToast({
                    title: "Can't open that card yet",
                    body: 'Its project is still syncing — try again in a moment.',
                    variant: 'warning',
                    duration: 4000,
                })
                return
            }

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
