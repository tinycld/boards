import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import { Menu } from '@tinycld/core/ui/menu'
import type { ReactElement } from 'react'
import { ESTIMATE_PRESETS, formatEstimate } from '../../lib/estimate'

interface EstimatePickerProps {
    /** Undefined when the card has no estimate. */
    selected?: number
    /** 0 clears — the stored form of "no estimate". */
    onSelect: (estimate: number) => void
    children: ReactElement
}

/**
 * Single-select over the preset ladder, the PriorityPicker shape.
 *
 * Presets rather than a number box: a menu row behaves identically on native
 * and web (no keyboard, no blur-commit, no validation state), and the coarse
 * steps are the point of estimating in points. "Clear estimate" is a separate
 * row, unlike priority's `none`, because 0 is not a value anyone would pick
 * as an estimate — it is the absence of one.
 */
export function EstimatePicker({ selected, onSelect, children }: EstimatePickerProps) {
    return (
        <Menu>
            <Menu.Trigger>{children}</Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="start">
                    {ESTIMATE_PRESETS.map(points => (
                        <MenuActionItem
                            key={points}
                            label={formatEstimate(points)}
                            isActive={points === selected}
                            testID={`cards-estimate-${points}`}
                            onPress={() => onSelect(points)}
                        />
                    ))}
                    <ClearItem isVisible={selected !== undefined} onPress={() => onSelect(0)} />
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}

function ClearItem({ isVisible, onPress }: { isVisible: boolean; onPress: () => void }) {
    if (!isVisible) return null
    return <MenuActionItem label="Clear estimate" testID="cards-estimate-clear" onPress={onPress} />
}
