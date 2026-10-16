import type { ReactElement } from 'react'
import { stringValue } from './form-value'

interface NewCardPickerProps<T extends { id: string }> {
    value: unknown
    onChange: (value: unknown) => void
    items: T[]
    renderPicker: (
        selected: T | undefined,
        pick: (id: string) => void,
        trigger: ReactElement
    ) => ReactElement
    renderValue: (selected: T | undefined) => ReactElement
}

/** The single-choice picker over a form value, shared by the fields that file a card under one row. */
export function NewCardPicker<T extends { id: string }>({
    value,
    onChange,
    items,
    renderPicker,
    renderValue,
}: NewCardPickerProps<T>) {
    const selected = items.find(item => item.id === stringValue(value))
    return renderPicker(selected, id => onChange(id), renderValue(selected))
}
