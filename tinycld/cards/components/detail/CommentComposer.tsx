import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { X } from 'lucide-react-native'
import { useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'

interface CommentComposerProps {
    widthClass: string
    onSubmit: (body: string) => void
    isPending: boolean
    /** Set while replying — shows the target and lets the user back out. */
    replyingTo?: { id: string; authorName: string }
    onCancelReply: () => void
}

export function CommentComposer({
    widthClass,
    onSubmit,
    isPending,
    replyingTo,
    onCancelReply,
}: CommentComposerProps) {
    const [body, setBody] = useState('')
    const mutedColor = useThemeColor('muted')

    const canSubmit = body.trim().length > 0 && !isPending

    const submit = () => {
        const trimmed = body.trim()
        if (!trimmed || isPending) return
        onSubmit(trimmed)
        setBody('')
    }

    return (
        <View className="border-t border-border px-4 pt-3 pb-2 bg-card">
            <View className={widthClass}>
                {replyingTo ? (
                    <View className="flex-row items-center gap-2 pb-1.5">
                        <Text className="text-[12px] text-muted">
                            Replying to {replyingTo.authorName}
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Cancel reply"
                            onPress={onCancelReply}
                            hitSlop={6}
                        >
                            <X size={12} color={mutedColor} strokeWidth={2.4} />
                        </Pressable>
                    </View>
                ) : null}

                <View className="flex-row items-end gap-2">
                    <View className="flex-1 border border-border rounded-[10px] bg-background px-3 py-[9px]">
                        <PlainInput
                            value={body}
                            onChangeText={setBody}
                            placeholder="Write a comment…"
                            placeholderTextColor={mutedColor}
                            multiline
                            editable={!isPending}
                            onKeyPress={e => {
                                // Enter alone inserts a newline — a comment is
                                // prose and often multi-line. ⌘/Ctrl+Enter is
                                // the send, matching the app's other composers.
                                if (e.nativeEvent.key !== 'Enter') return
                                const native = e.nativeEvent as unknown as {
                                    metaKey?: boolean
                                    ctrlKey?: boolean
                                }
                                if (native.metaKey || native.ctrlKey) submit()
                            }}
                            className="text-[13.5px] text-foreground"
                        />
                    </View>
                    <Button onPress={submit} isDisabled={!canSubmit} size="sm">
                        <ButtonText>{isPending ? 'Sending…' : 'Send'}</ButtonText>
                    </Button>
                </View>

                <ShortcutHint />
            </View>
        </View>
    )
}

function ShortcutHint() {
    if (Platform.OS !== 'web') return null
    return (
        <Text className="text-center text-[11px] text-muted pt-[7px]">
            ⌘↩ send&ensp;·&ensp;J / K next · previous card&ensp;·&ensp;Esc close
        </Text>
    )
}
