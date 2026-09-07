import { Menu } from '@tinycld/core/ui/menu'
import { type CardPriority, PRIORITIES, priorityLabel } from '../../lib/priority'
import { PriorityGlyph } from '../PriorityGlyph'
import { anchorPropsFor, type PickerAnchor } from './picker-anchor'

type PriorityPickerProps = {
    /**
     * Undefined marks NO row — which is what a bulk selection whose cards
     * disagree needs. A card always has a priority, so the card detail always
     * passes one.
     */
    selected?: CardPriority
    onSelect: (priority: CardPriority) => void
} & PickerAnchor

/**
 * Single-select over the fixed scale, the ReporterPicker shape.
 *
 * `none` is a row like any other rather than a separate "Clear" item: it is a
 * value the schema names, the automation catalog offers it the same way, and a
 * reader looking for "make this not urgent any more" finds it where the other
 * four are instead of at the bottom under a different verb.
 */
export function PriorityPicker({ selected, onSelect, ...anchor }: PriorityPickerProps) {
    return (
        <Menu {...anchorPropsFor(anchor)} placement="bottom-start" title="Priority">
            {PRIORITIES.map(priority => (
                <Menu.Item
                    key={priority}
                    label={priorityLabel(priority)}
                    isSelected={priority === selected}
                    leading={<PriorityGlyph priority={priority} size={14} />}
                    onSelect={() => onSelect(priority)}
                />
            ))}
        </Menu>
    )
}
