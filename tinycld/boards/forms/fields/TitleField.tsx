import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { TextInput } from '@tinycld/core/ui/form'
import { View } from 'react-native'
import { EditableText } from '../../components/detail/EditableText'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { useAdapterData } from '../CardFormContext'

/**
 * The title, edited in place; `titleRef` lets the container's `e` shortcut
 * start an edit. Before the card exists it is a plain input bound to the
 * form, which is what the wizard validates.
 */
export function TitleField({ disabled, fieldKey, label }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    const updateCard = useUpdateCard()
    if (!data) return null
    if (data.mode === 'create') {
        return (
            <TextInput
                control={data.control}
                hideError
                name={fieldKey}
                placeholder="Card title"
                testID={`form-input-${fieldKey}`}
                accessibilityLabel={label}
            />
        )
    }
    const { card, canEdit, titleRef } = data
    return (
        <View className="mt-1 mb-[18px]">
            <EditableText
                ref={titleRef}
                value={card.title}
                onSave={title => updateCard.mutate({ cardId: card.id, title })}
                placeholder="Card title"
                accessibilityLabel="Edit card title"
                textClassName="text-[20px] font-semibold leading-[27px] tracking-tight text-foreground"
                isDisabled={!canEdit}
            />
        </View>
    )
}
