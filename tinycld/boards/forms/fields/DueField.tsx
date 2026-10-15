import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { DuePicker } from '../../components/detail/DuePicker'
import { DueValue } from '../../components/detail/property-values'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { useAdapterData } from '../CardFormContext'

/** The due date. The form's value is ignored: the live card row is the truth. */
export function DueField({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const updateCard = useUpdateCard()
    if (!data) return null
    const { card, canEdit } = data
    if (!canEdit) return <DueValue due={card.due} dueHasTime={card.dueHasTime} />
    return (
        <DuePicker
            value={card.due}
            hasTime={card.dueHasTime}
            allowTime
            onChange={pick =>
                updateCard.mutate({ cardId: card.id, due: pick.date, dueHasTime: pick.hasTime })
            }
        >
            <DueValue due={card.due} dueHasTime={card.dueHasTime} />
        </DuePicker>
    )
}
