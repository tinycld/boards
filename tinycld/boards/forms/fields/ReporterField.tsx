import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { UserField } from '@tinycld/core/ui/forms/fields/UserField'
import { PropertyRow, ReporterValue } from '../../components/detail/property-values'
import { ReporterPicker } from '../../components/detail/ReporterPicker'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { useAdapterData } from '../CardFormContext'
import { stringValue } from './form-value'

/** Left empty in the create dialog, the creator is the reporter (useCreateCard). */
export function ReporterField({ disabled, fieldKey, label, value, onChange }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const updateCard = useUpdateCard()
    if (data.mode === 'create') {
        return (
            <UserField
                value={stringValue(value)}
                onChange={onChange}
                multiple={false}
                testID={`form-input-${fieldKey}`}
                accessibilityLabel={label}
            />
        )
    }
    const { card, canEdit, projectMembers } = data
    if (!canEdit) {
        return (
            <PropertyRow name={label}>
                <ReporterValue card={card} />
            </PropertyRow>
        )
    }
    return (
        <PropertyRow name={label}>
            <ReporterPicker
                members={projectMembers}
                selectedId={card.reporter?.id}
                onSelect={reporter => updateCard.mutate({ cardId: card.id, reporter })}
            >
                <ReporterValue card={card} />
            </ReporterPicker>
        </PropertyRow>
    )
}
