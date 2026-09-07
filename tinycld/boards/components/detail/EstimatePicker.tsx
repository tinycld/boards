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
        <Menu trigger={children} placement="bottom-start" title="Estimate">
            {ESTIMATE_PRESETS.map(points => (
                <Menu.Item
                    key={points}
                    label={formatEstimate(points)}
                    isSelected={points === selected}
                    testID={`boards-estimate-${points}`}
                    onSelect={() => onSelect(points)}
                />
            ))}
            <ClearItem isVisible={selected !== undefined} onPress={() => onSelect(0)} />
        </Menu>
    )
}

function ClearItem({ isVisible, onPress }: { isVisible: boolean; onPress: () => void }) {
    if (!isVisible) return null
    return <Menu.Item label="Clear estimate" testID="boards-estimate-clear" onSelect={onPress} />
}
