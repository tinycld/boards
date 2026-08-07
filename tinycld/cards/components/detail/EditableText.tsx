import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

interface EditableTextProps {
    value: string
    onSave: (value: string) => void
    /** Shown in place of an empty value; pressing it starts an edit. */
    placeholder: string
    multiline?: boolean
    /** Applied to both the display text and the input, so editing doesn't jump. */
    textClassName?: string
    /** Display styling for the empty-state placeholder. */
    placeholderClassName?: string
    accessibilityLabel: string
    isDisabled?: boolean
}

/**
 * Click-to-edit text, used for the card title and description.
 *
 * Saves on blur as well as on Enter (or ⌘Enter when multiline). Blur-to-save is
 * the important one: someone who types a description and then clicks a checklist
 * item has unambiguously finished editing, and losing that text because they
 * did not press a key is the kind of bug that makes people stop trusting a
 * field. Escape reverts — that is the explicit discard.
 *
 * The draft lives in local state rather than writing through on every keystroke:
 * a mutation per character would flood the server, and the optimistic update
 * would fight the input's own value.
 */
export function EditableText({
    value,
    onSave,
    placeholder,
    multiline = false,
    textClassName = 'text-[14px] leading-[22px] text-foreground',
    placeholderClassName = 'text-[13.5px] text-muted',
    accessibilityLabel,
    isDisabled = false,
}: EditableTextProps) {
    const [isEditing, setIsEditing] = useState(false)
    const [draft, setDraft] = useState(value)
    // Escape must restore what was there when the edit STARTED, not the latest
    // prop — a realtime update mid-edit would otherwise become the revert target.
    const committedRef = useRef(value)
    const mutedColor = useThemeColor('muted')

    const beginEdit = () => {
        if (isDisabled) return
        committedRef.current = value
        setDraft(value)
        setIsEditing(true)
    }

    const commit = () => {
        setIsEditing(false)
        const trimmed = draft.trim()
        // Nothing to do when unchanged: an update would bump `updated` and wake
        // every subscribed board client for a no-op.
        if (trimmed === value.trim()) return
        onSave(trimmed)
    }

    const cancel = () => {
        setDraft(committedRef.current)
        setIsEditing(false)
    }

    if (!isEditing) {
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                onPress={beginEdit}
                className={
                    value
                        ? 'web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring rounded-lg'
                        : 'bg-foreground/5 rounded-lg px-3.5 py-3 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring'
                }
            >
                <Text className={value ? textClassName : placeholderClassName}>
                    {value || placeholder}
                </Text>
            </Pressable>
        )
    }

    return (
        <View className="bg-background border border-border rounded-lg px-3 py-2">
            <PlainInput
                value={draft}
                onChangeText={setDraft}
                placeholder={placeholder}
                placeholderTextColor={mutedColor}
                autoFocus
                multiline={multiline}
                // A single-line field submits on Enter. A multiline one must not
                // — Enter is a newline there — so it commits on ⌘Enter or blur.
                blurOnSubmit={!multiline}
                onSubmitEditing={multiline ? undefined : commit}
                onBlur={commit}
                onKeyPress={e => {
                    if (e.nativeEvent.key === 'Escape') {
                        cancel()
                        return
                    }
                    // ⌘/Ctrl+Enter commits a multiline edit, where plain Enter
                    // has to stay a newline. RN's KeyPress event does not type
                    // the modifier flags, but react-native-web forwards the DOM
                    // event's, so they are read off the native event.
                    if (!multiline || e.nativeEvent.key !== 'Enter') return
                    const native = e.nativeEvent as unknown as {
                        metaKey?: boolean
                        ctrlKey?: boolean
                    }
                    if (native.metaKey || native.ctrlKey) commit()
                }}
                className={textClassName}
                style={multiline ? { minHeight: 72 } : undefined}
            />
        </View>
    )
}
