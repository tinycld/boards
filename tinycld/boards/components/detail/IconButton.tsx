import { Tooltip } from '@tinycld/core/components/Tooltip'
import { forwardRef, type ReactNode } from 'react'
import { Pressable, type View } from 'react-native'

const BUTTON_CLASS =
    'w-7 h-7 items-center justify-center rounded-[7px] hover:bg-foreground/5 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring'

interface IconButtonProps {
    label: string
    onPress?: () => void
    /** Greyed out and inert; the tooltip still shows `label`, which says why. */
    disabled?: boolean
    children: ReactNode
}

/**
 * forwardRef because it doubles as a Menu trigger, which is cloned with an
 * `onPress` and the ref the surface anchors against.
 *
 * The Tooltip sits INSIDE that forwardRef, around the Pressable — never around
 * this component where a Menu would use it as a trigger. Core's Tooltip is a
 * Fragment on native, so a surface cloning it would hand the onPress and the
 * measurement ref to the Fragment and the menu would never open.
 */
export const IconButton = forwardRef<View, IconButtonProps>(function IconButton(
    { label, onPress, disabled, children },
    ref
) {
    return (
        <Tooltip label={label}>
            <Pressable
                ref={ref}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={onPress}
                disabled={disabled}
                accessibilityState={{ disabled }}
                aria-disabled={disabled}
                className={disabled ? `${BUTTON_CLASS} opacity-40` : BUTTON_CLASS}
            >
                {children}
            </Pressable>
        </Tooltip>
    )
})
