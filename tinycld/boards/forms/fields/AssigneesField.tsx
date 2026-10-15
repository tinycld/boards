import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { AssigneePicker } from '../../components/detail/AssigneePicker'
import { AssigneesValue } from '../../components/detail/property-values'
import { useToggleCardRelation } from '../../hooks/useCardMutations'
import { useAdapterData } from '../CardFormContext'

export function AssigneesField({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const toggleRelation = useToggleCardRelation()
    if (!data) return null
    const { card, canEdit, projectMembers } = data
    if (!canEdit) return <AssigneesValue card={card} />
    const assignedIds = card.assignees.map(member => member.id)
    return (
        <AssigneePicker
            members={projectMembers}
            assignedIds={assignedIds}
            onToggle={(id, isSelected) =>
                toggleRelation.mutate({ cardId: card.id, field: 'assignees', id, isSelected })
            }
        >
            <AssigneesValue card={card} />
        </AssigneePicker>
    )
}
