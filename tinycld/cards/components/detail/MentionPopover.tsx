import { triggerPopoverKind } from '@tinycld/core/lib/editor/message-bus/popover-protocol'
import {
    AnchoredOverlayController,
    type AnchoredOverlayProps,
    type AnchoredOverlayRegistry,
    useEditorOverlay,
} from '@tinycld/core/lib/editor/overlay'
import type { TriggerItem, TriggerState } from '@tinycld/core/lib/editor/rich'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Pressable, ScrollView, Text, View } from 'react-native'

// The `@`-mention picker (native).
//
// Metro resolves MentionPopover.web.tsx on web; this file is what native gets.
// The two look the same to a caller and diverge completely underneath, because
// on native the editor is a WebView: the trigger plugin runs INSIDE the page,
// so the popover has to be drawn by the host, and the two are different JS
// contexts that cannot share React state.
//
// What that means for the props. Web reads `state` — the live TriggerState the
// plugin publishes on the host. Here `state` is ACCEPTED AND IGNORED: the
// equivalent state lives in the page and reaches us serialized, over the
// message bus, as the overlay's payload. The prop stays so the call sites are
// platform-blind and the two files cannot drift apart.
//
// `overlayKey` is the load-bearing one. The controller needs the editor's
// WebView ref to translate the page's viewport coordinates into screen
// coordinates, and this popover is rendered as a SIBLING of the editor (in the
// comment case, a different subtree entirely), so no context can reach it. The
// editor publishes its handle under this key and we look it up.

/** Keyed on the trigger id core's page-side bridge posts. */
const REGISTRY: AnchoredOverlayRegistry = {
    [triggerPopoverKind('cards-mention')]: MentionPopoverBody,
}

interface MentionPopoverProps {
    state: TriggerState
    overlayKey?: string
}

export function MentionPopover({ overlayKey }: MentionPopoverProps) {
    const overlay = useEditorOverlay(overlayKey)
    // Null until the editor's registration effect runs — one render, on mount.
    if (!overlay) return null
    return (
        <AnchoredOverlayController
            webViewRef={overlay.webViewRef as React.RefObject<unknown>}
            editorInstanceId={overlay.editorInstanceId}
            registry={REGISTRY}
        />
    )
}

/**
 * The overlay body. Deliberately dumb: it renders what the page sent and
 * reports taps back.
 *
 * Keyboard navigation is NOT here, matching the web variant. The page's
 * suggestion plugin owns the keystrokes — arrows and Enter reach the editor,
 * not this view, which is never focused — and each one arrives as a fresh
 * payload with a new `selectedIndex`.
 */
function MentionPopoverBody({ payload, respond }: AnchoredOverlayProps) {
    const mutedColor = useThemeColor('muted')
    const contents = payload as { items?: TriggerItem[]; selectedIndex?: number } | null
    const items = contents?.items ?? []
    const selectedIndex = contents?.selectedIndex ?? 0

    return (
        <View testID="cards-mention-popover" className="overflow-hidden rounded-md">
            <NoMatches isVisible={items.length === 0} color={mutedColor} />
            <ScrollView
                // Without this the first tap only dismisses the keyboard, so
                // picking someone always takes two.
                keyboardShouldPersistTaps="always"
                className="max-h-56"
            >
                {items.map((item, index) => (
                    <MentionRow
                        key={item.id}
                        item={item}
                        isSelected={index === selectedIndex}
                        color={mutedColor}
                        onSelect={() => respond('select', { itemId: item.id })}
                    />
                ))}
            </ScrollView>
        </View>
    )
}

function NoMatches({ isVisible, color }: { isVisible: boolean; color: string }) {
    if (!isVisible) return null
    return (
        <Text className="px-3 py-2 text-[13px]" style={{ color }}>
            No matches
        </Text>
    )
}

function MentionRow({
    item,
    isSelected,
    color,
    onSelect,
}: {
    item: TriggerItem
    isSelected: boolean
    color: string
    onSelect: () => void
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Mention ${item.label}`}
            onPress={onSelect}
            className={`px-3 py-2 ${isSelected ? 'bg-muted/15' : ''}`}
        >
            <Text className="text-[13px] text-foreground" numberOfLines={1}>
                {item.label}
            </Text>
            <SecondaryLine text={item.secondary} color={color} />
        </Pressable>
    )
}

function SecondaryLine({ text, color }: { text?: string; color: string }) {
    if (!text) return null
    return (
        <Text className="text-[11px]" style={{ color }} numberOfLines={1}>
            {text}
        </Text>
    )
}
