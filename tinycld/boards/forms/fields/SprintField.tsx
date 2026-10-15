import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { PropertyRow, SprintValue } from '../../components/detail/property-values'
import { SprintPicker } from '../../components/detail/SprintPicker'
import { useUpdateCard } from '../../hooks/useCardMutations'
import type { BoardSprint } from '../../types'
import { useAdapterData } from '../CardFormContext'
import { stringValue } from './form-value'

/** Only on a board that plans in sprints, as in the properties block. */
export function SprintField({ disabled, label, value, onChange }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const updateCard = useUpdateCard()
    if (!data) return null
    if (!data.sprintsEnabled) return null
    if (data.mode === 'create') {
        return <NewCardSprint sprints={data.sprints} value={value} onChange={onChange} />
    }
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
}: {
    sprints: BoardSprint[]
    value: unknown
    onChange: (value: unknown) => void
}) {
    const sprint = sprints.find(s => s.id === stringValue(value)) ?? null
    return (
        <SprintPicker sprints={sprints} selectedId={sprint?.id ?? ''} onSelect={onChange}>
            <SprintValue sprint={sprint} />
        </SprintPicker>
    )
}
