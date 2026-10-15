import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { DateField } from '@tinycld/core/ui/forms/fields/DateField'
import { DuePicker } from '../../components/detail/DuePicker'
import { DueValue, PropertyRow } from '../../components/detail/property-values'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { useAdapterData } from '../CardFormContext'
import { stringValue } from './form-value'

/**
 * The due date. On a card the form's value is ignored: the live card row is
 * the truth. Before the card exists it is core's date input over the form
 * value, a plain day.
 */
export function DueField({ disabled, fieldKey, label, value, onChange }: BuiltinFieldProps) {
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
                <DueValue due={card.due} dueHasTime={card.dueHasTime} />
            </PropertyRow>
        )
    }
    return (
        <PropertyRow name={label}>
            <DuePicker
                value={card.due}
                hasTime={card.dueHasTime}
                allowTime
                onChange={pick =>
                    updateCard.mutate({
                        cardId: card.id,
                        due: pick.date,
                        dueHasTime: pick.hasTime,
                    })
                }
            >
                <DueValue due={card.due} dueHasTime={card.dueHasTime} />
            </DuePicker>
        </PropertyRow>
    )
}
