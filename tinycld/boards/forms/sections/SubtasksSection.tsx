import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { DetailSubtasks } from '../../components/detail/DetailSubtasks'
import { isSectionShown } from '../../lib/card-sections'
import { hasSubtaskSection } from '../../lib/subtasks'
import { useSectionReveal } from '../../stores/section-reveal-store'
import { type CardFormValue, useAdapterData } from '../CardFormContext'

/**
 * Gated on card-write, not on the children query: a sub-task is a card of its
 * own, so filing one does not wait on the checklist and comments loading.
 */
export function SubtasksSection({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    if (data?.mode !== 'card') return null
    return <Subtasks data={data} />
}

function Subtasks({ data }: { data: CardFormValue }) {
    const { card, projectCards, projectId, canEdit } = data
    const { isRevealed, setRevealed } = useSectionReveal(card.id, 'subtasks')
    return (
        <DetailSubtasks
            card={card}
            projectCards={projectCards}
            projectId={projectId}
            canEdit={canEdit}
            isVisible={isSectionShown(hasSubtaskSection(projectCards, card), isRevealed)}
            isComposing={isRevealed}
            onComposingChange={setRevealed}
        />
    )
}
