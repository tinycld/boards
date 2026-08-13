import type { TriggerItem, TriggerState } from '@tinycld/core/lib/editor/rich'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { createPortal } from 'react-dom'
import { Pressable, Text, View, type ViewStyle } from 'react-native'

// The `@`-mention picker (web).
//
// Portals to document.body so it floats over the editor rather than being
// clipped by the card detail's scroll container — the same reason text's slash
// menu does, and the reason this cannot simply be a sibling <View>.
//
// Keyboard handling is deliberately NOT here. The editor owns the keystrokes
// (this popover is never focused), so arrows/Enter/Escape are handled inside
// the trigger plugin and arrive as `selectedIndex` changes. A focused popover
// would take the caret out of the editor, which is what makes most autocomplete
// implementations feel wrong.

const GAP_PX = 4
// Rough height used to decide whether to flip above the caret. A measured flip
// would be tighter but costs a layout-then-paint flicker; matching text's
// approach keeps the two pickers behaving the same.
const HEIGHT_ESTIMATE_PX = 220
const WIDTH_PX = 260

// `position: 'fixed'` is a web value React Native's ViewStyle does not model,
// so it is declared once and cast — the same treatment DescriptionEditor gives
// its sticky header. Fixed rather than absolute because the popover is
// portalled to <body> and must track the viewport, not the page.
const FIXED = { position: 'fixed' } as unknown as ViewStyle

// React Native Web forwards unknown props to the DOM node, so a web-only
// mouse handler rides through here. Typed once and cast, the same treatment
// `position: fixed` gets above — ViewProps models neither.
const PREVENT_BLUR = {
    onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
} as unknown as { onMouseDown: (e: unknown) => void }

function resolvePosition(anchor: NonNullable<TriggerState['anchor']>) {
    if (typeof window === 'undefined') {
        return { top: anchor.bottom + GAP_PX, left: anchor.left }
    }
    const wouldOverflowBottom = anchor.bottom + GAP_PX + HEIGHT_ESTIMATE_PX > window.innerHeight
    const top = wouldOverflowBottom
        ? Math.max(8, anchor.top - GAP_PX - HEIGHT_ESTIMATE_PX)
        : anchor.bottom + GAP_PX
    const left = Math.min(Math.max(8, anchor.left), Math.max(8, window.innerWidth - WIDTH_PX - 8))
    return { top, left }
}

interface MentionPopoverProps {
    state: TriggerState
}

export function MentionPopover({ state }: MentionPopoverProps) {
    // `isVisible`-style early return rather than the caller branching — see
    // CLAUDE.md on conditional visibility.
    if (!state.isOpen || !state.anchor || state.items.length === 0) return null
    if (typeof document === 'undefined') return null

    return createPortal(<MentionList state={state} />, document.body)
}

function MentionList({ state }: MentionPopoverProps) {
    const anchor = state.anchor
    if (!anchor) return null
    const { top, left } = resolvePosition(anchor)

    return (
        <View
            testID="cards-mention-popover"
            className="rounded-[10px] border border-border bg-card py-1 shadow-lg"
            style={[FIXED, { top, left, width: WIDTH_PX, zIndex: 1000 }]}
        >
            {state.items.map((item, index) => (
                <MentionRow
                    key={item.id}
                    item={item}
                    isSelected={index === state.selectedIndex}
                    onSelect={state.onSelect}
                />
            ))}
        </View>
    )
}

function MentionRow({
    item,
    isSelected,
    onSelect,
}: {
    item: TriggerItem
    isSelected: boolean
    onSelect: (item: TriggerItem) => void
}) {
    const mutedColor = useThemeColor('muted')
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Mention ${item.label}`}
            // Suppress the default mouse-down so the EDITOR NEVER BLURS.
            //
            // This is the whole trick, and getting it wrong fails in a way that
            // looks like the popover is broken: the suggestion plugin resolves
            // the trigger's text range from the editor's live selection, so a
            // blur before the command runs leaves it with nowhere to write —
            // the popover stays open and the typed `@` is never replaced.
            // (Observed exactly that way in card-mentions.spec.ts before this
            // was added.) preventDefault on mouse-down stops the browser from
            // moving focus at all, which is why the click can then run against
            // a still-focused editor.
            {...PREVENT_BLUR}
            onPress={() => onSelect(item)}
            className={`px-3 py-1.5 ${isSelected ? 'bg-muted/15' : ''}`}
        >
            <Text className="text-[13px] text-foreground" numberOfLines={1}>
                {item.label}
            </Text>
            <SecondaryLine text={item.secondary} color={mutedColor} />
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
