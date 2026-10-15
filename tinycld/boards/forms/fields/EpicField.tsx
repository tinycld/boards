import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { EpicPicker } from '../../components/detail/EpicPicker'
import { EpicValue, PropertyRow } from '../../components/detail/property-values'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { boardUsesEpics } from '../../lib/epics'
import type { BoardEpic } from '../../types'
import { type AdapterData, useAdapterData } from '../CardFormContext'
import { NewCardPicker } from './NewCardPicker'

type CardData = Extract<AdapterData, { mode: 'card' }>

/** Only on a board that has epics to file under, as in the properties block. */
export function EpicField(props: BuiltinFieldProps) {
    const data = useAdapterData(props.disabled)
    if (data.mode === 'create') {
        return <NewCardEpic epics={data.epics} {...props} />
    }
    return <CardEpic label={props.label} data={data} />
}

function CardEpic({ label, data }: { label: string; data: CardData }) {
    const updateCard = useUpdateCard()
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
}: { epics: BoardEpic[] } & Pick<BuiltinFieldProps, 'value' | 'onChange'>) {
    if (!boardUsesEpics(epics, { epic: null })) return null
    return (
        <NewCardPicker
            value={value}
            onChange={onChange}
            items={epics}
            renderPicker={(selected, pick, trigger) => (
                <EpicPicker epics={epics} selectedId={selected?.id ?? ''} onSelect={pick}>
                    {trigger}
                </EpicPicker>
            )}
            renderValue={selected => <EpicValue epic={selected ?? null} />}
        />
    )
}
