import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { X } from 'lucide-react-native'
import { useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import type { BoardAttachment } from '../../types'
import { CommentEditor } from './CommentEditor'

interface CommentComposerProps {
    widthClass: string
    /** For the editor's image inserts — they become card attachments. */
    cardId: string
    projectId: string
    attachments: BoardAttachment[]
    onSubmit: (body: string) => void
    isPending: boolean
    /** Set while replying — shows the target and lets the user back out. */
    replyingTo?: { id: string; authorName: string }
    onCancelReply: () => void
}

/**
 * The comment composer: collapsed to a plain pressable row until first use,
 * then the rich markdown editor with the formatting toolbar.
 *
 * Collapsed-until-tap is not a styling choice. On native every rich editor is
 * a TenTap WebView, and the card detail already carries one permanently (the
 * description) — mounting a second for a composer most card-opens never touch
 * would double the WebView cost of merely LOOKING at a card. Web collapses
 * too, so both platforms walk the same path and the e2e suite exercises the
 * real thing. Once opened it stays mounted for the life of the open card:
 * unmounting on blur would drop an in-progress draft and re-pay the WebView
 * boot on the next tap.
 */
export function CommentComposer({
    widthClass,
    cardId,
    projectId,
    attachments,
    onSubmit,
    isPending,
    replyingTo,
    onCancelReply,
}: CommentComposerProps) {
    const [wasOpened, setWasOpened] = useState(false)
    // Derived during render, not an effect: pressing Reply must open the
    // composer without anyone tapping it first.
    const isOpen = wasOpened || !!replyingTo

    return (
        <View
            testID="cards-comment-composer"
            className="border-t border-border px-4 pt-3 pb-2 bg-card"
        >
            <View className={widthClass}>
                <ReplyChip replyingTo={replyingTo} onCancelReply={onCancelReply} />
                {isOpen ? (
                    <CommentEditor
                        cardId={cardId}
                        projectId={projectId}
                        attachments={attachments}
                        placeholder="Write a comment…"
                        autofocus
                        // Pressing Reply targets THIS composer, so the shared
                        // editor comes back to it — the press blurs whatever
                        // held the editor, and without this the composer would
                        // sit open with no editor in it.
                        acquireToken={replyingTo?.id ?? ''}
                        isPending={isPending}
                        onSubmit={onSubmit}
                        testID="cards-comment-composer-editor"
                    />
                ) : (
                    <CollapsedComposer onPress={() => setWasOpened(true)} />
                )}
                <ShortcutHint />
            </View>
        </View>
    )
}

/** The idle affordance — styled like the input frame it expands into. */
function CollapsedComposer({ onPress }: { onPress: () => void }) {
    const mutedColor = useThemeColor('muted')
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Write a comment"
            onPress={onPress}
            className="border border-border rounded-[10px] bg-background px-3 py-[9px]"
        >
            <Text className="text-[13.5px]" style={{ color: mutedColor }}>
                Write a comment…
            </Text>
        </Pressable>
    )
}

function ReplyChip({
    replyingTo,
    onCancelReply,
}: {
    replyingTo?: { id: string; authorName: string }
    onCancelReply: () => void
}) {
    const mutedColor = useThemeColor('muted')
    if (!replyingTo) return null
    return (
        <View className="flex-row items-center gap-2 pb-1.5">
            <Text className="text-[12px] text-muted">Replying to {replyingTo.authorName}</Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel reply"
                onPress={onCancelReply}
                hitSlop={6}
            >
                <X size={12} color={mutedColor} strokeWidth={2.4} />
            </Pressable>
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
