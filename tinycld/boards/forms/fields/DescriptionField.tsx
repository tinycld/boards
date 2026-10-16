import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { RichTextField } from '@tinycld/core/ui/forms/fields/RichTextField'
import { View } from 'react-native'
import { useCardDescription } from '../CardDescriptionContext'
import { useAdapterData } from '../CardFormContext'
import { stringValue } from './form-value'

/**
 * The card description inside the card's form.
 *
 * On a card, this is only the editing surface: CardDescriptionProvider owns
 * the editor and hands it over, because its header is a separate row the form
 * pins above this cell (see DescriptionHeader). The editor binds to the
 * board's shared document under the description's own `card:<id>` fragment,
 * not the `fragment` prop: the server writes that fragment back to
 * `boards_cards.description`.
 */
export function DescriptionField({
    disabled,
    fieldKey,
    label,
    value,
    onChange,
}: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    if (data.mode === 'create') {
        // No card, so no room either: core's editor over the form's value.
        return (
            <RichTextField
                fieldKey={fieldKey}
                value={stringValue(value)}
                onChange={onChange}
                format="markdown"
                testID={`form-input-${fieldKey}`}
                accessibilityLabel={label}
            />
        )
    }
    return <DescriptionBody />
}

function DescriptionBody() {
    const { body } = useCardDescription()
    if (!body) return null
    return <View className="mb-6 overflow-visible">{body}</View>
}
