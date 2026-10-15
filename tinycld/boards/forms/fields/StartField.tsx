import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { DateField } from '@tinycld/core/ui/forms/fields/DateField'
import { DuePicker } from '../../components/detail/DuePicker'
import { PropertyRow, StartValue } from '../../components/detail/property-values'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { type AdapterData, useAdapterData } from '../CardFormContext'
import { stringValue } from './form-value'

type CardData = Extract<AdapterData, { mode: 'card' }>

/**
 * The start date: always a plain day. On a card it writes through the card
 * update, like the due date; before the card exists it is core's date input
 * over the form value.
 */
export function StartField(props: BuiltinFieldProps) {
    const data = useAdapterData(props.disabled)
    if (data.mode === 'create') return <NewCardStart {...props} />
    return <CardStart label={props.label} data={data} />
}

function NewCardStart({ fieldKey, label, value, onChange }: BuiltinFieldProps) {
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

function CardStart({ label, data }: { label: string; data: CardData }) {
    const updateCard = useUpdateCard()
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
