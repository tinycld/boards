import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { iosInputCenteringStyle } from '@tinycld/core/ui/form/ios-input-style'
import { TextInput, View } from 'react-native'
import { EditableText } from '../../components/detail/EditableText'
import { useUpdateCard } from '../../hooks/useCardMutations'
import { type AdapterData, useAdapterData } from '../CardFormContext'
import { stringValue } from './form-value'

type CardData = Extract<AdapterData, { mode: 'card' }>

/**
 * The title, edited in place; `titleRef` lets the container's `e` shortcut
 * start an edit. Before the card exists it is a plain input over the form
 * value, which is what the wizard validates.
 */
export function TitleField(props: BuiltinFieldProps) {
    const data = useAdapterData(props.disabled)
    if (data.mode === 'create') return <NewCardTitle {...props} />
    return <CardTitle data={data} />
}

function NewCardTitle({ disabled, fieldKey, label, value, onChange }: BuiltinFieldProps) {
    const placeholderColor = useThemeColor('field-placeholder')
    return (
        <TextInput
            value={stringValue(value) ?? ''}
            onChangeText={onChange}
            editable={!disabled}
            placeholder="Card title"
            placeholderTextColor={placeholderColor}
            testID={`form-input-${fieldKey}`}
            accessibilityLabel={label}
            className="border border-border rounded-lg px-3 py-2.5 text-base text-foreground bg-background"
            style={iosInputCenteringStyle(16)}
        />
    )
}

function CardTitle({ data }: { data: CardData }) {
    const updateCard = useUpdateCard()
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
