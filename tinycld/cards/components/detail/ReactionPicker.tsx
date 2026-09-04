import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import { SmilePlus } from 'lucide-react-native'
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
 * The six-emoji grid behind the smiley. Menu.Item rows so a pick closes the
 * popover and the keyboard works on web; laid out three across rather than
 * one per row because six glyphs in a column reads as a list of nothing.
 * No search and no wider set — the palette is the schema.
 */
export function ReactionPicker({ onPick }: ReactionPickerProps) {
    const mutedColor = useThemeColor('muted')
    return (
        <Menu>
            <Menu.Trigger>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add reaction"
                    testID="cards-reaction-add"
                    className="w-6 h-6 items-center justify-center rounded-full border border-dashed border-border hover:border-muted web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
                >
                    <SmilePlus size={13} color={mutedColor} strokeWidth={2.2} />
                </Pressable>
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="start">
                    <View className="flex-row flex-wrap w-[168px]">
                        {REACTION_PALETTE.map(emoji => (
                            <Menu.Item
                                key={emoji}
                                className="w-14 items-center justify-center"
                                testID={`cards-reaction-pick-${REACTION_KEYS[emoji]}`}
                                onPress={() => onPick(emoji)}
                            >
                                <Text
                                    accessibilityLabel={REACTION_LABELS[emoji]}
                                    className="text-[18px]"
                                >
                                    {emoji}
                                </Text>
                            </Menu.Item>
                        ))}
                    </View>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
