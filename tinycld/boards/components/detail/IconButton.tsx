import type { ReactNode } from 'react'
import { Pressable } from 'react-native'

interface IconButtonProps {
    label: string
    onPress?: () => void
    children: ReactNode
}

export function IconButton({ label, onPress, children }: IconButtonProps) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            className="w-7 h-7 items-center justify-center rounded-[7px] hover:bg-foreground/5 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            {children}
        </Pressable>
    )
}
