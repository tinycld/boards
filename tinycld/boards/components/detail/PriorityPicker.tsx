import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import { Menu } from '@tinycld/core/ui/menu'
import type { ReactElement } from 'react'
import { type CardPriority, PRIORITIES, priorityLabel } from '../../lib/priority'
import { PriorityGlyph } from '../PriorityGlyph'

interface PriorityPickerProps {
    selected: CardPriority
    onSelect: (priority: CardPriority) => void
    children: ReactElement
}

/**
 * Single-select over the fixed scale, the ReporterPicker shape.
 *
 * `none` is a row like any other rather than a separate "Clear" item: it is a
 * value the schema names, the automation catalog offers it the same way, and a
 * reader looking for "make this not urgent any more" finds it where the other
 * four are instead of at the bottom under a different verb.
 */
export function PriorityPicker({ selected, onSelect, children }: PriorityPickerProps) {
    return (
        <Menu>
            <Menu.Trigger>{children}</Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="start">
                    {PRIORITIES.map(priority => (
                        <MenuActionItem
                            key={priority}
                            label={priorityLabel(priority)}
                            isActive={priority === selected}
                            leading={<PriorityGlyph priority={priority} size={14} />}
                            onPress={() => onSelect(priority)}
                        />
                    ))}
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
