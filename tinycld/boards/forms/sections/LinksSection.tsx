import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { DetailLinks } from '../../components/detail/DetailLinks'
import { useCardLinks } from '../../hooks/useCardLinks'
import { isSectionShown } from '../../lib/card-sections'
import { useSectionReveal } from '../../stores/section-reveal-store'
import { type CardFormValue, useAdapterData } from '../CardFormContext'
import { useCardsById } from './use-cards-by-id'

export function LinksSection({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    if (data?.mode !== 'card') return null
    return <Links data={data} />
}

function Links({ data }: { data: CardFormValue }) {
    const { card, projectCards, projectId, canEdit } = data
    const cardsById = useCardsById(projectCards)
    // The card set is ready by construction: every card surface renders only
    // once the board's cards are loaded.
    const { links, addLink, removeLink, isAdding } = useCardLinks(card.id, cardsById, true)
    const { isRevealed, setRevealed } = useSectionReveal(card.id, 'links')
    return (
        <DetailLinks
            card={card}
            links={links}
            addLink={addLink}
            removeLink={removeLink}
            isAddingLink={isAdding}
            cardsById={cardsById}
            pickerCards={projectCards}
            projectId={projectId}
            canEdit={canEdit}
            isVisible={isSectionShown(links.length > 0, isRevealed)}
            isComposing={isRevealed}
            onComposingChange={setRevealed}
        />
    )
}
