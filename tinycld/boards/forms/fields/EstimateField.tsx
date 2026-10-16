import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { EstimatePicker } from '../../components/detail/EstimatePicker'
import { EstimateValue, PropertyRow } from '../../components/detail/property-values'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { type AdapterData, useAdapterData } from '../CardFormContext'

type CardData = Extract<AdapterData, { mode: 'card' }>

/** A form value as an estimate: a positive number, or none. */
function estimateOf(value: unknown): number | undefined {
    return typeof value === 'number' && value > 0 ? value : undefined
}

/**
 * The estimate. Before the card exists it is the card's own preset picker
 * over the form value; clearing it (0) leaves the value empty.
 */
export function EstimateField(props: BuiltinFieldProps) {
    const data = useAdapterData(props.disabled)
    if (data.mode === 'create') return <NewCardEstimate {...props} />
    return <CardEstimate label={props.label} data={data} />
}

function NewCardEstimate({ value, onChange }: BuiltinFieldProps) {
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

function CardEstimate({ label, data }: { label: string; data: CardData }) {
    const updateCard = useUpdateCard()
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
