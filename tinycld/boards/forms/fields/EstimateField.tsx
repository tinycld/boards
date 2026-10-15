import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { EstimatePicker } from '../../components/detail/EstimatePicker'
import { EstimateValue } from '../../components/detail/property-values'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { useAdapterData } from '../CardFormContext'

export function EstimateField({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const updateCard = useUpdateCard()
    if (!data) return null
    const { card, canEdit } = data
    if (!canEdit) return <EstimateValue estimate={card.estimate} />
    return (
        <EstimatePicker
            selected={card.estimate}
            onSelect={estimate => updateCard.mutate({ cardId: card.id, estimate })}
        >
            <EstimateValue estimate={card.estimate} />
        </EstimatePicker>
    )
}
