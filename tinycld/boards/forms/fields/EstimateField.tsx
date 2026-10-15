import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { NumberInput } from '@tinycld/core/ui/form'
import { EstimatePicker } from '../../components/detail/EstimatePicker'
import { EstimateValue, PropertyRow } from '../../components/detail/property-values'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { useAdapterData } from '../CardFormContext'

export function EstimateField({ disabled, fieldKey, label }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const updateCard = useUpdateCard()
    if (!data) return null
    if (data.mode === 'create') {
        return (
            <NumberInput
                control={data.control}
                hideError
                name={fieldKey}
                min={0}
                allowDecimal
                testID={`form-input-${fieldKey}`}
                accessibilityLabel={label}
            />
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
