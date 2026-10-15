import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { SprintValue } from '../../components/detail/property-values'
import { SprintPicker } from '../../components/detail/SprintPicker'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { useAdapterData } from '../CardFormContext'

/** Only on a board that plans in sprints, as in the properties block. */
export function SprintField({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const updateCard = useUpdateCard()
    if (!data) return null
    const { card, canEdit, projectSprints, sprintsEnabled } = data
    if (!sprintsEnabled) return null
    if (!canEdit) return <SprintValue sprint={card.sprint} />
    return (
        <SprintPicker
            sprints={projectSprints}
            selectedId={card.sprint?.id ?? ''}
            onSelect={sprint => updateCard.mutate({ cardId: card.id, sprint })}
        >
            <SprintValue sprint={card.sprint} />
        </SprintPicker>
    )
}
