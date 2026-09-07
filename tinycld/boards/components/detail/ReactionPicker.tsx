import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Popover } from '@tinycld/core/ui/popover'
import { SmilePlus } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import {
    REACTION_KEYS,
    REACTION_LABELS,
    REACTION_PALETTE,
    type ReactionEmoji,
} from '../../lib/reactions'

interface ReactionPickerProps {
    onPick: (emoji: ReactionEmoji) => void
}

/**
 * The six-emoji grid behind the smiley. A Popover rather than a Menu because
 * a grid of glyphs is not a list of commands; laid out three across rather
 * than one per row because six glyphs in a column reads as a list of nothing.
 * Controlled so a pick closes it. No search and no wider set — the palette is
 * the schema.
 */
export function ReactionPicker({ onPick }: ReactionPickerProps) {
    const mutedColor = useThemeColor('muted')
    const [isOpen, setIsOpen] = useState(false)

    const pick = (emoji: ReactionEmoji) => {
        onPick(emoji)
        setIsOpen(false)
    }

    return (
        <Popover
            isOpen={isOpen}
            onOpenChange={setIsOpen}
            trigger={
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add reaction"
                    testID="boards-reaction-add"
                    className="w-6 h-6 items-center justify-center rounded-full border border-dashed border-border hover:border-muted web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
                >
                    <SmilePlus size={13} color={mutedColor} strokeWidth={2.2} />
                </Pressable>
            }
            placement="bottom-start"
            title="Add reaction"
        >
            <View className="flex-row flex-wrap w-[168px]">
                {REACTION_PALETTE.map(emoji => (
                    <Pressable
                        key={emoji}
                        accessibilityRole="button"
                        accessibilityLabel={REACTION_LABELS[emoji]}
                        testID={`boards-reaction-pick-${REACTION_KEYS[emoji]}`}
                        onPress={() => pick(emoji)}
                        className="w-14 h-10 items-center justify-center rounded-md hover:bg-accent web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
                    >
                        <Text className="text-[18px]">{emoji}</Text>
                    </Pressable>
                ))}
            </View>
        </Popover>
    )
}
