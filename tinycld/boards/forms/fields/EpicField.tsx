import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { EpicPicker } from '../../components/detail/EpicPicker'
import { EpicValue, PropertyRow } from '../../components/detail/property-values'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { boardUsesEpics } from '../../lib/epics'
import type { BoardEpic } from '../../types'
import { useAdapterData } from '../CardFormContext'
import { stringValue } from './form-value'

/** Only on a board that has epics to file under, as in the properties block. */
export function EpicField({ disabled, label, value, onChange }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const updateCard = useUpdateCard()
    if (!data) return null
    if (data.mode === 'create') {
        return <NewCardEpic epics={data.epics} value={value} onChange={onChange} />
    }
    const { card, canEdit, projectEpics } = data
    if (!boardUsesEpics(projectEpics, card)) return null
    if (!canEdit) {
        return (
            <PropertyRow name={label}>
                <EpicValue epic={card.epic} />
            </PropertyRow>
        )
    }
    return (
        <PropertyRow name={label}>
            <EpicPicker
                epics={projectEpics}
                selectedId={card.epic?.id ?? ''}
                onSelect={epic => updateCard.mutate({ cardId: card.id, epic })}
            >
                <EpicValue epic={card.epic} />
            </EpicPicker>
        </PropertyRow>
    )
}

function NewCardEpic({
    epics,
    value,
    onChange,
}: {
    epics: BoardEpic[]
    value: unknown
    onChange: (value: unknown) => void
}) {
    const epic = epics.find(e => e.id === stringValue(value)) ?? null
    if (!boardUsesEpics(epics, { epic })) return null
    return (
        <EpicPicker epics={epics} selectedId={epic?.id ?? ''} onSelect={onChange}>
            <EpicValue epic={epic} />
        </EpicPicker>
    )
}
