import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Plus } from 'lucide-react-native'
import { forwardRef } from 'react'
import { Pressable, Text, type View } from 'react-native'

/**
 * A dashed outline chip: "nothing here yet — tap to add".
 *
 * One component rather than one per caller, because the dashes are a vocabulary
 * rather than a decoration. An unset property row and a hidden optional section
 * are the same offer to the reader, so they have to look the same; two copies of
 * this styling would drift and the equivalence would stop reading.
 *
 * Forwards its ref because the property pickers CLONE their trigger to inject
 * `onPress` and a ref — see DetailProperties' Value components.
 */
export const GhostChip = forwardRef<
    View,
    { label: string; onPress?: () => void; hasPlusIcon?: boolean }
>(function GhostChip({ label, onPress, hasPlusIcon = false }, ref) {
    const mutedColor = useThemeColor('muted')
    return (
        <Pressable
            ref={ref}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            className={`flex-row items-center gap-1 border border-dashed border-border rounded-full py-[3px] hover:border-muted web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring ${
                hasPlusIcon ? 'pl-1.5 pr-2.5' : 'px-2.5'
            }`}
        >
            {/* The property rows say what they add in words ("Set due date"), so
                the glyph would be redundant there. A section chip is the bare
                section NAME, which reads as a label until the plus makes it an
                action. */}
            {hasPlusIcon ? <Plus size={11} color={mutedColor} strokeWidth={2.4} /> : null}
            <Text className="text-[12px] font-medium text-muted">{label}</Text>
        </Pressable>
    )
})
