import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { EstimatePicker } from '../../components/detail/EstimatePicker'
import { EstimateValue, PropertyRow } from '../../components/detail/property-values'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { useAdapterData } from '../CardFormContext'

/** A form value as an estimate: a positive number, or none. */
function estimateOf(value: unknown): number | undefined {
    return typeof value === 'number' && value > 0 ? value : undefined
}

/**
 * The estimate. Before the card exists it is the card's own preset picker
 * over the form value; clearing it (0) leaves the value empty.
 */
export function EstimateField({ disabled, label, value, onChange }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const updateCard = useUpdateCard()
    if (data.mode === 'create') {
        const estimate = estimateOf(value)
        return (
            <EstimatePicker
                selected={estimate}
                onSelect={points => onChange(estimateOf(points) ?? null)}
            >
                <EstimateValue estimate={estimate} />
            </EstimatePicker>
        )
    }
    const { card, canEdit } = data
    if (!canEdit) {
        return (
            <PropertyRow name={label}>
                <EstimateValue estimate={card.estimate} />
            </PropertyRow>
        )
    }
    return (
        <PropertyRow name={label}>
            <EstimatePicker
                selected={card.estimate}
                onSelect={estimate => updateCard.mutate({ cardId: card.id, estimate })}
            >
                <EstimateValue estimate={card.estimate} />
            </EstimatePicker>
        </PropertyRow>
    )
}
