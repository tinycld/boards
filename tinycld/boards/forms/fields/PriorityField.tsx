import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { PriorityPicker } from '../../components/detail/PriorityPicker'
import { PriorityValue } from '../../components/detail/property-values'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { normalizePriority } from '../../lib/priority'
import { useAdapterData } from '../CardFormContext'
import { stringValue } from './form-value'

export function PriorityField({ disabled, value, onChange }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const updateCard = useUpdateCard()
    if (!data) return null
    if (data.mode === 'create') {
        const priority = normalizePriority(stringValue(value) ?? undefined)
        return (
            <PriorityPicker selected={priority} onSelect={onChange}>
                <PriorityValue priority={priority} />
            </PriorityPicker>
        )
    }
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
