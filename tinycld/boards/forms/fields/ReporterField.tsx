import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { ReporterValue } from '../../components/detail/property-values'
import { ReporterPicker } from '../../components/detail/ReporterPicker'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { useAdapterData } from '../CardFormContext'

export function ReporterField({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const updateCard = useUpdateCard()
    if (!data) return null
    const { card, canEdit, projectMembers } = data
    if (!canEdit) return <ReporterValue card={card} />
    return (
        <ReporterPicker
            members={projectMembers}
            selectedId={card.reporter?.id}
            onSelect={reporter => updateCard.mutate({ cardId: card.id, reporter })}
        >
            <ReporterValue card={card} />
        </ReporterPicker>
    )
}
