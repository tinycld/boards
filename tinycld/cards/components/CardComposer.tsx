import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { Plus } from 'lucide-react-native'
import { useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

interface CardComposerProps {
    /** Adds the card. Returning keeps the composer open for the next one. */
    onSubmit: (title: string) => void
    isPending?: boolean
    /** "Add card" by default; a column with no cards can say more. */
    label?: string
    placeholder?: string
    /**
     * Open state, when a parent owns it — the `n` shortcut opens a composer
     * inside a memoized column it holds no reference to. Omit both and the
     * composer stays self-contained, as it is on the empty-board path.
     */
    isOpen?: boolean
    onOpenChange?: (isOpen: boolean) => void
}

/**
 * The inline "add card" affordance: a button until pressed, then a one-line
 * composer.
 *
 * Enter submits AND STAYS OPEN. Adding cards is a burst activity — someone
 * filling a column types five titles in a row, and a composer that closes after
 * each one turns five keystrokes into fifteen. Escape closes; so does blurring
 * an empty field, which is what makes clicking away feel like a cancel rather
 * than leaving a stray input on the board.
 *
 * This is deliberately NOT react-hook-form. One field with no validation beyond
 * "not blank" does not need a resolver, a schema, or a form context — the
 * useState here is the genuinely-local UI state the style guide reserves it for.
 */
export function CardComposer({
    onSubmit,
    isPending = false,
    label = 'Add card',
    placeholder = 'What needs doing?',
    isOpen: controlledOpen,
    onOpenChange,
}: CardComposerProps) {
    const [internalOpen, setInternalOpen] = useState(false)
    const [title, setTitle] = useState('')
    const inputRef = useRef<React.ComponentRef<typeof PlainInput>>(null)
    const mutedColor = useThemeColor('muted')

    // Controlled-ness keys on `isOpen` being supplied, not on `onOpenChange` —
    // core's Menu learned this the hard way (a bare handler there once left the
    // internal state stuck closed). A bare handler here merely notifies.
    const isOpen = controlledOpen ?? internalOpen
    const setIsOpen = (next: boolean) => {
        if (controlledOpen === undefined) setInternalOpen(next)
        onOpenChange?.(next)
    }

    const submit = () => {
        const trimmed = title.trim()
        if (!trimmed) {
            setIsOpen(false)
            return
        }
        onSubmit(trimmed)
        setTitle('')
        // The input keeps focus, so the next title can be typed immediately.
        inputRef.current?.focus()
    }

    if (!isOpen) {
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => setIsOpen(true)}
                className="flex-row items-center gap-2 px-2.5 py-2 rounded-[10px] hover:bg-foreground/5 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                <Plus size={14} color={mutedColor} strokeWidth={2.2} />
                <Text className="text-[13px] font-medium text-muted">{label}</Text>
            </Pressable>
        )
    }

    return (
        <View className="p-0.5">
            <View className="bg-background rounded-[10px] px-2.5 py-2 border border-foreground/10">
                <PlainInput
                    ref={inputRef}
                    value={title}
                    onChangeText={setTitle}
                    placeholder={placeholder}
                    placeholderTextColor={mutedColor}
                    autoFocus
                    multiline={false}
                    editable={!isPending}
                    returnKeyType="done"
                    // blurOnSubmit={false} keeps focus for the next title;
                    // without it RN dismisses the keyboard on every Enter.
                    blurOnSubmit={false}
                    onSubmitEditing={submit}
                    onBlur={() => {
                        if (!title.trim()) setIsOpen(false)
                    }}
                    onKeyPress={e => {
                        if (e.nativeEvent.key === 'Escape') setIsOpen(false)
                    }}
                    className="text-[13px] text-foreground"
                />
            </View>
        </View>
    )
}
