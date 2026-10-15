import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { LabelPicker } from '../../components/detail/LabelPicker'
import { LabelsValue, PropertyRow } from '../../components/detail/property-values'
import { useToggleCardRelation } from '../../hooks/useCardMutations'
import type { BoardLabel } from '../../types'
import { useAdapterData } from '../CardFormContext'
import { stringList } from './form-value'

export function LabelsField({ disabled, label, value, onChange }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const toggleRelation = useToggleCardRelation()
    if (data.mode === 'create') {
        return <NewCardLabels labels={data.labels} value={value} onChange={onChange} />
    }
    const { card, canEdit, projectLabels, onManageLabels } = data
    if (!canEdit) {
        return (
            <PropertyRow name={label}>
                <LabelsValue card={card} />
            </PropertyRow>
        )
    }
    const selectedIds = card.labels.map(each => each.id)
    return (
        <PropertyRow name={label}>
            <LabelPicker
                labels={projectLabels}
                selectedIds={selectedIds}
                onToggle={(id, isSelected) =>
                    toggleRelation.mutate({ cardId: card.id, field: 'labels', id, isSelected })
                }
                onManage={onManageLabels}
            >
                <LabelsValue card={card} />
            </LabelPicker>
        </PropertyRow>
    )
}

/**
 * The same picker over the form's value. No "Manage labels…": the manager is
 * a dialog of its own, which would stack on the create dialog.
 */
function NewCardLabels({
    labels,
    value,
    onChange,
}: {
    labels: BoardLabel[]
    value: unknown
    onChange: (value: unknown) => void
}) {
    const selectedIds = stringList(value)
    const selected = labels.filter(label => selectedIds.includes(label.id))
    const toggle = (id: string, isSelected: boolean) =>
        onChange(isSelected ? selectedIds.filter(other => other !== id) : [...selectedIds, id])
    return (
        <LabelPicker labels={labels} selectedIds={selectedIds} onToggle={toggle}>
            <LabelsValue card={{ labels: selected }} />
        </LabelPicker>
    )
}
