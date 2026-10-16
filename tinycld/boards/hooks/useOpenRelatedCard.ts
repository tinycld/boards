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
 * returns to the card it was opened from.
 *
 * On the peek and the modal the store is the opener, and the board layout
 * pushes that card's peek (useOpenCardSync), so Back returns here too.
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
