import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { PriorityPicker } from '../../components/detail/PriorityPicker'
import { PriorityValue } from '../../components/detail/property-values'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { useAdapterData } from '../CardFormContext'

export function PriorityField({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const updateCard = useUpdateCard()
    if (!data) return null
    const { card, canEdit } = data
    if (!canEdit) return <PriorityValue priority={card.priority} />
    return (
        <PriorityPicker
            selected={card.priority}
            onSelect={priority => updateCard.mutate({ cardId: card.id, priority })}
        >
            <PriorityValue priority={card.priority} />
        </PriorityPicker>
    )
}
