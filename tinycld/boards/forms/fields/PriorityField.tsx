import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { PriorityPicker } from '../../components/detail/PriorityPicker'
import { PriorityValue, PropertyRow } from '../../components/detail/property-values'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { normalizePriority } from '../../lib/priority'
import { type AdapterData, useAdapterData } from '../CardFormContext'
import { stringValue } from './form-value'

type CardData = Extract<AdapterData, { mode: 'card' }>

export function PriorityField(props: BuiltinFieldProps) {
    const data = useAdapterData(props.disabled)
    if (data.mode === 'create') return <NewCardPriority {...props} />
    return <CardPriority label={props.label} data={data} />
}

function NewCardPriority({ value, onChange }: BuiltinFieldProps) {
    const priority = normalizePriority(stringValue(value) ?? undefined)
    return (
        <PriorityPicker selected={priority} onSelect={onChange}>
            <PriorityValue priority={priority} />
        </PriorityPicker>
    )
}

function CardPriority({ label, data }: { label: string; data: CardData }) {
    const updateCard = useUpdateCard()
    const { card, canEdit } = data
    if (!canEdit) {
        return (
            <PropertyRow name={label}>
                <PriorityValue priority={card.priority} />
            </PropertyRow>
        )
    }
    return (
        <PropertyRow name={label}>
            <PriorityPicker
                selected={card.priority}
                onSelect={priority => updateCard.mutate({ cardId: card.id, priority })}
            >
                <PriorityValue priority={card.priority} />
            </PriorityPicker>
        </PropertyRow>
    )
}
