import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { EmojiPicker } from '@tinycld/core/ui/emoji-picker'
import { SmilePlus } from 'lucide-react-native'
import { forwardRef } from 'react'
import { Pressable, type View } from 'react-native'

interface ReactionPickerProps {
    onPick: (emoji: string) => void
}

/**
 * The smiley that opens the full emoji picker.
 *
 * This used to be the picker itself — a six-glyph grid, because the palette
 * was the schema. Now it is only the trigger; core owns the picker so other
 * packages can use it too.
 */
export function ReactionPicker({ onPick }: ReactionPickerProps) {
    return (
        <EmojiPicker
            trigger={<AddReactionButton />}
            onPick={onPick}
            placement="bottom-start"
            testID="boards-reaction-picker"
        />
    )
}

/**
 * forwardRef because Popover clones its trigger to inject onPress and a ref it
 * measures for placement — a component that swallows either would leave the
 * picker unable to open or unable to position itself.
 */
const AddReactionButton = forwardRef<View, { onPress?: () => void }>(
    function AddReactionButton(props, ref) {
        const mutedColor = useThemeColor('muted')
        return (
            <Pressable
                {...props}
                ref={ref}
                accessibilityRole="button"
                accessibilityLabel="Add reaction"
                testID="boards-reaction-add"
                className="w-6 h-6 items-center justify-center rounded-full border border-dashed border-border hover:border-muted web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                <SmilePlus size={13} color={mutedColor} strokeWidth={2.2} />
            </Pressable>
        )
    }
)
