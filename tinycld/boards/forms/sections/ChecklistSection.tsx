import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { ChecklistField } from '@tinycld/core/ui/forms/fields/ChecklistField'
import { DetailChecklist } from '../../components/detail/DetailChecklist'
import { useCardDetail } from '../../hooks/useCardDetail'
import { isSectionShown } from '../../lib/card-sections'
import { useSectionReveal } from '../../stores/section-reveal-store'
import { type CardFormValue, useAdapterData } from '../CardFormContext'
import { checklistItems } from '../fields/form-value'

/**
 * The checklist. On a card it is the card's own section, writing its rows
 * directly; before the card exists it is core's checklist over the form
 * value, which the create dialog inserts with the card.
 */
export function ChecklistSection({
    disabled,
    fieldKey,
    label,
    value,
    onChange,
}: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    if (!data) return null
    if (data.mode === 'create') {
        return (
            <ChecklistField
                value={checklistItems(value)}
                onChange={onChange}
                testID={`form-input-${fieldKey}`}
                accessibilityLabel={label}
            />
        )
    }
    return <Checklist data={data} />
}

function Checklist({ data }: { data: CardFormValue }) {
    const { card, projectId, canEdit } = data
    const { checklist, isReady } = useCardDetail(card.id)
    const { isRevealed, setRevealed } = useSectionReveal(card.id, 'checklist')
    return (
        <DetailChecklist
            items={checklist}
            cardId={card.id}
            projectId={projectId}
            // Not before the children query settles: an empty result then
            // cannot be told from a card with no items, and a live composer
            // would invite re-adding them.
            canEdit={canEdit && isReady}
            isVisible={isSectionShown(checklist.length > 0, isRevealed)}
            isComposing={isRevealed}
            onComposingChange={setRevealed}
        />
    )
}
