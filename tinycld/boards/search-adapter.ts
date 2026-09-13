import { useOrgHref } from '@tinycld/core/lib/org-routes'
import type { SearchRow } from '@tinycld/core/lib/search/types'
import { useRouter } from 'expo-router'

// Row shaping (title, subtitle, meta) is the server's job — see
// boards/server/search.go. Normalizing there rather than here means the palette
// and the CLI render identical rows from one implementation; a TypeScript
// version could only ever serve the browser.
//
// What remains client-side is selection, which needs a router that exists only
// in the app.

// The palette calls this for every in-scope package while it is open, so it
// only takes handles — no fetching, no subscriptions.
//
// Selection does not read the card from the local store: boards_cards syncs
// per open board, so a hit on a board the reader has not opened this session
// is not in memory. The bare `/a/boards?focused=<id>` route resolves the id
// with a live query that waits for the row (screens/index.tsx), then lands on
// the card peeked on its own board — the same path core's mention
// notifications take.
export function useSearchActions() {
    const router = useRouter()
    const orgHref = useOrgHref()

    return {
        onSelect: (row: SearchRow) => {
            // `navigate` rather than `push` so a board already on screen is
            // reused, not stacked.
            router.navigate(orgHref('boards', { focused: row.id }))
        },
    }
}
