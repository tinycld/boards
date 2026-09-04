import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import type { SearchRow } from '@tinycld/core/lib/search/types'
import { useToastStore } from '@tinycld/core/lib/stores/toast-store'
import { useRouter } from 'expo-router'
import { useBoardsUIStore } from './stores/boards-ui-store'

// Row shaping (title, subtitle, meta) is the server's job — see
// boards/server/search.go. Normalizing there rather than here means the palette
// and the CLI render identical rows from one implementation; a TypeScript
// version could only ever serve the browser.
//
// What remains client-side is selection, which needs a router and stores that
// exist only in the app.

// The palette calls this for every in-scope package while it is open, so it
// only takes handles — no fetching, no subscriptions. The cards UI store has
// no cardId -> projectId map, so selection resolves the card's project by
// reading the already-syncing local collection synchronously via .get() —
// this is a plain lookup into data already in memory, not a live query.
export function useSearchActions() {
    const router = useRouter()
    const orgHref = useOrgHref()
    const [cardsCollection] = useStore('boards_cards')

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

            const { setActiveProject, openCard } = useBoardsUIStore.getState()

            // The [cardId] screen derives its card from the ROUTE PARAM, not
            // from openCardId, so switching the project underneath it would
            // leave a stale id in the URL rendering "card doesn't exist".
            router.replace(orgHref('boards'))

            // Order matters: setActiveProject deliberately clears openCardId,
            // so opening the card first would immediately undo it. Both are
            // synchronous Zustand set() calls batched into one render.
            setActiveProject(projectId)
            openCard(row.id)
        },
    }
}
