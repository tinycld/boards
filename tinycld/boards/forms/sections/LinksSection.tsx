import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { useMemo } from 'react'
import { DetailLinks } from '../../components/detail/DetailLinks'
import { useCardLinks } from '../../hooks/useCardLinks'
import { type CardFormValue, useAdapterData } from '../CardFormContext'

export function LinksSection({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    if (!data) return null
    return <Links data={data} />
}

function Links({ data }: { data: CardFormValue }) {
    const { card, projectCards, projectId, canEdit } = data
    // This board's cards only: the far end of a CROSS-BOARD link is
    // deliberately unresolvable here, which is what the redacted row renders.
    const cardsById = useMemo(
        () => new Map(projectCards.map(entry => [entry.id, entry])),
        [projectCards]
    )
    // The card set is ready by construction: every card surface renders only
    // once the board's cards are loaded.
    const { links, addLink, removeLink, isAdding } = useCardLinks(card.id, cardsById, true)
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
        />
    )
}
