import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { DateField } from '@tinycld/core/ui/forms/fields/DateField'
import { DuePicker } from '../../components/detail/DuePicker'
import { PropertyRow, StartValue } from '../../components/detail/property-values'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { useAdapterData } from '../CardFormContext'
import { stringValue } from './form-value'

/**
 * The start date: always a plain day. On a card it writes through the card
 * update, like the due date; before the card exists it is core's date input
 * over the form value.
 */
export function StartField({ disabled, fieldKey, label, value, onChange }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const updateCard = useUpdateCard()
    if (!data) return null
    if (data.mode === 'create') {
        return (
            <DateField
                value={stringValue(value)}
                onChange={onChange}
                withTime={false}
                testID={`form-input-${fieldKey}`}
                accessibilityLabel={label}
            />
        )
    }
    const { card, canEdit } = data
    if (!canEdit) {
        return (
            <PropertyRow name={label}>
                <StartValue start={card.start} />
            </PropertyRow>
        )
    }
    return (
        <PropertyRow name={label}>
            <DuePicker
                value={card.start}
                title="Start date"
                onChange={pick => updateCard.mutate({ cardId: card.id, start: pick.date })}
            >
                <StartValue start={card.start} />
            </DuePicker>
        </PropertyRow>
    )
}
