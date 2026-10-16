import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useRouter } from 'expo-router'
import { useCardFormContext } from '../forms/CardFormContext'
import { cardHref } from '../lib/board-route'
import { useBoardsUIStore } from '../stores/boards-ui-store'

/**
 * Open a card on this board from a row inside the open card (a sub-task, a
 * link).
 *
 * On the full page the next card gets its own page, pushed on top, so Back
 * returns to the card it was opened from. The board stays mounted under the
 * page, so opening through the store there would navigate back to the board's
 * peek and lose the page.
 *
 * On the peek and the modal the store is the opener, and usePeekUrl writes the
 * change as a history REPLACE: the board route is singular
 * (screens/_layout.tsx), so even a push of it replaces the entry on web. Back
 * walking the cards opened on the peek is an open follow-up.
 */
export function useOpenRelatedCard() {
    const { variant, projectId, projectSlug } = useCardFormContext()
    const openCard = useBoardsUIStore(s => s.openCard)
    const router = useRouter()
    const orgHref = useOrgHref()
    return (card: { id: string; number: number }) => {
        if (variant === 'page') {
            router.push(cardHref(orgHref, { id: projectId, slug: projectSlug }, card))
        } else {
            openCard(card.id)
        }
    }
}
