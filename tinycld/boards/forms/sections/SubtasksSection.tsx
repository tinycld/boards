import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { DetailSubtasks } from '../../components/detail/DetailSubtasks'
import { useAdapterData } from '../CardFormContext'

/**
 * Gated on card-write, not on the children query: a sub-task is a card of its
 * own, so filing one does not wait on the checklist and comments loading.
 */
export function SubtasksSection({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    if (data?.mode !== 'card') return null
    return (
        <DetailSubtasks
            card={data.card}
            projectCards={data.projectCards}
            projectId={data.projectId}
            canEdit={data.canEdit}
        />
    )
}
