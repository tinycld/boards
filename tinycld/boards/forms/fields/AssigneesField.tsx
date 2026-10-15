import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { AssigneePicker } from '../../components/detail/AssigneePicker'
import { AssigneesValue, PropertyRow } from '../../components/detail/property-values'
import { useToggleCardRelation } from '../../hooks/useCardMutations'
import type { BoardMember } from '../../types'
import { useAdapterData } from '../CardFormContext'
import { stringList } from './form-value'

export function AssigneesField({ disabled, label, value, onChange }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const toggleRelation = useToggleCardRelation()
    if (data.mode === 'create') {
        return <NewCardAssignees members={data.members} value={value} onChange={onChange} />
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

/**
 * The same picker over the form's value: the board's members, not the org,
 * since a card can only be assigned to someone who can open the board.
 */
function NewCardAssignees({
    members,
    value,
    onChange,
}: {
    members: BoardMember[]
    value: unknown
    onChange: (value: unknown) => void
}) {
    const assignedIds = stringList(value)
    const assignees = members.filter(member => assignedIds.includes(member.id))
    const toggle = (id: string, isSelected: boolean) =>
        onChange(isSelected ? assignedIds.filter(other => other !== id) : [...assignedIds, id])
    return (
        <AssigneePicker members={members} assignedIds={assignedIds} onToggle={toggle}>
            <AssigneesValue card={{ assignees }} />
        </AssigneePicker>
    )
}
