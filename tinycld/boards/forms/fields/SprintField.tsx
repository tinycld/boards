import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { PropertyRow, SprintValue } from '../../components/detail/property-values'
import { SprintPicker } from '../../components/detail/SprintPicker'
import { useUpdateCard } from '../../hooks/useCardMutations'
import type { BoardSprint } from '../../types'
import { type AdapterData, useAdapterData } from '../CardFormContext'
import { NewCardPicker } from './NewCardPicker'

type CardData = Extract<AdapterData, { mode: 'card' }>

/** Only on a board that plans in sprints, as in the properties block. */
export function SprintField(props: BuiltinFieldProps) {
    const data = useAdapterData(props.disabled)
    if (!data.sprintsEnabled) return null
    if (data.mode === 'create') {
        return <NewCardSprint sprints={data.sprints} {...props} />
    }
    return <CardSprint label={props.label} data={data} />
}

function CardSprint({ label, data }: { label: string; data: CardData }) {
    const updateCard = useUpdateCard()
    const { card, canEdit, projectSprints } = data
    if (!canEdit) {
        return (
            <PropertyRow name={label}>
                <SprintValue sprint={card.sprint} />
            </PropertyRow>
        )
    }
    return (
        <PropertyRow name={label}>
            <SprintPicker
                sprints={projectSprints}
                selectedId={card.sprint?.id ?? ''}
                onSelect={sprint => updateCard.mutate({ cardId: card.id, sprint })}
            >
                <SprintValue sprint={card.sprint} />
            </SprintPicker>
        </PropertyRow>
    )
}

function NewCardSprint({
    sprints,
    value,
    onChange,
}: { sprints: BoardSprint[] } & Pick<BuiltinFieldProps, 'value' | 'onChange'>) {
    return (
        <NewCardPicker
            value={value}
            onChange={onChange}
            items={sprints}
            renderPicker={(selected, pick, trigger) => (
                <SprintPicker sprints={sprints} selectedId={selected?.id ?? ''} onSelect={pick}>
                    {trigger}
                </SprintPicker>
            )}
            renderValue={selected => <SprintValue sprint={selected ?? null} />}
        />
    )
}
