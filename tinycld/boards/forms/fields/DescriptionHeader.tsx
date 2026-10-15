import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { useAdapterData } from '../CardFormContext'

/**
 * The description's label and toolbar row, which the form pins to the top of
 * the card while the description scrolls past (`pinned` in ui.ts). Hidden
 * exactly when the body is, so a read-only card with no description drops
 * the whole section.
 */
export function DescriptionHeader({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    if (data.mode !== 'card') return null
    return data.description.body ? data.description.header : null
}
