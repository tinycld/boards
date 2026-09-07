import { forwardRef, type ReactNode } from 'react'
import { Pressable, type View } from 'react-native'

interface IconButtonProps {
    label: string
    onPress?: () => void
    children: ReactNode
}

/**
 * forwardRef because it doubles as a Menu trigger, which is cloned with an
 * `onPress` and the ref the surface anchors against.
 */
export const IconButton = forwardRef<View, IconButtonProps>(function IconButton(
    { label, onPress, children },
    ref
) {
    return (
        <Pressable
            ref={ref}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            className="w-7 h-7 items-center justify-center rounded-[7px] hover:bg-foreground/5 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            {children}
        </Pressable>
    )
})
