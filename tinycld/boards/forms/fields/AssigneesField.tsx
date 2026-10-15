import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { UserField } from '@tinycld/core/ui/forms/fields/UserField'
import { AssigneePicker } from '../../components/detail/AssigneePicker'
import { AssigneesValue, PropertyRow } from '../../components/detail/property-values'
import { useToggleCardRelation } from '../../hooks/useCardMutations'
import { useAdapterData } from '../CardFormContext'
import { stringList } from './form-value'

export function AssigneesField({ disabled, fieldKey, label, value, onChange }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const toggleRelation = useToggleCardRelation()
    if (data.mode === 'create') {
        return (
            <UserField
                value={stringList(value)}
                onChange={onChange}
                multiple
                testID={`form-input-${fieldKey}`}
                accessibilityLabel={label}
            />
        )
    }
    const { card, canEdit, projectMembers } = data
    if (!canEdit) {
        return (
            <PropertyRow name={label}>
                <AssigneesValue card={card} />
            </PropertyRow>
        )
    }
    const assignedIds = card.assignees.map(member => member.id)
    return (
        <PropertyRow name={label}>
            <AssigneePicker
                members={projectMembers}
                assignedIds={assignedIds}
                onToggle={(id, isSelected) =>
                    toggleRelation.mutate({ cardId: card.id, field: 'assignees', id, isSelected })
                }
            >
                <AssigneesValue card={card} />
            </AssigneePicker>
        </PropertyRow>
    )
}
