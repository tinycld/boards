import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { EditableText } from '../../components/detail/EditableText'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { useAdapterData } from '../CardFormContext'

/** The title, edited in place; `titleRef` lets the container's `e` shortcut start an edit. */
export function TitleField({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const updateCard = useUpdateCard()
    if (!data) return null
    const { card, canEdit, titleRef } = data
    return (
        <EditableText
            ref={titleRef}
            value={card.title}
            onSave={title => updateCard.mutate({ cardId: card.id, title })}
            placeholder="Card title"
            accessibilityLabel="Edit card title"
            textClassName="text-[20px] font-semibold leading-[27px] tracking-tight text-foreground"
            isDisabled={!canEdit}
        />
    )
}
