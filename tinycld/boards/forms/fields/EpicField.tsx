import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { EpicPicker } from '../../components/detail/EpicPicker'
import { EpicValue } from '../../components/detail/property-values'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { boardUsesEpics } from '../../lib/epics'
import { useAdapterData } from '../CardFormContext'

/** Only on a board that has epics to file under, as in the properties block. */
export function EpicField({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const updateCard = useUpdateCard()
    if (!data) return null
    const { card, canEdit, projectEpics } = data
    if (!boardUsesEpics(projectEpics, card)) return null
    if (!canEdit) return <EpicValue epic={card.epic} />
    return (
        <EpicPicker
            epics={projectEpics}
            selectedId={card.epic?.id ?? ''}
            onSelect={epic => updateCard.mutate({ cardId: card.id, epic })}
        >
            <EpicValue epic={card.epic} />
        </EpicPicker>
    )
}
