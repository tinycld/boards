import { useCardFormContext } from '../forms/CardFormContext'
import { useCardNavigation } from './useCardNavigation'

/**
 * Open a card on this board from a row inside the open card (a sub-task, a
 * link).
 *
 * On the full page the next card gets its own page, on the peek and the modal
 * its own peek. Both are pushed, so Back returns to the card it was opened from.
 * A card the server has not numbered has no page URL yet, so from the page it
 * opens as a peek.
 */
export function useOpenRelatedCard() {
    const { variant } = useCardFormContext()
    const { openPage, openPeek } = useCardNavigation()
    return (card: { id: string; key: string; number: number }) => {
        if (variant === 'page' && openPage && card.number) openPage(card)
        else openPeek(card)
    }
}
