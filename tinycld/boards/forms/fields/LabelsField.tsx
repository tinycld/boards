import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { LabelPicker } from '../../components/detail/LabelPicker'
import { LabelsValue } from '../../components/detail/property-values'
import { useToggleCardRelation } from '../../hooks/useCardMutations'
import { useAdapterData } from '../CardFormContext'

export function LabelsField({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const toggleRelation = useToggleCardRelation()
    if (!data) return null
    const { card, canEdit, projectLabels, onManageLabels } = data
    if (!canEdit) return <LabelsValue card={card} />
    const selectedIds = card.labels.map(label => label.id)
    return (
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
    )
}
