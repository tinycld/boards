import type { TriggerState } from '@tinycld/core/lib/editor/rich'

// The `@`-mention picker (native) — NOT YET IMPLEMENTED.
//
// Metro resolves MentionPopover.web.tsx on web; this file is what native gets.
// It renders nothing, deliberately and visibly, rather than pretending.
//
// WHY IT IS EMPTY. On native the editor is a WebView, so the trigger plugin
// runs INSIDE the page and the popover has to be drawn by the host — the two
// are in different JS contexts and cannot share React state. Core's message bus
// already specifies the protocol for exactly this (`show-popover`,
// `popover-update`, `popover-result`, `popover-dismissed` in
// lib/editor/message-bus/types.ts), and text/ has a working implementation of
// the host side (components/SlashMenuPopover.tsx +
// lib/anchored-overlay/anchored-overlay-controller). Wiring cards' trigger onto
// that bridge is the remaining work; it is a self-contained piece and does not
// change anything on the web path.
//
// WHAT NATIVE USERS GET MEANWHILE: no picker. Everything else works —
// a `[[@id]]` token typed by hand, or synced from a description someone wrote
// on the web, still notifies and still renders as the person's name. Only the
// autocomplete affordance is missing.
//
// The props match the web variant exactly so the call site is platform-blind
// and the two cannot drift.
interface MentionPopoverProps {
    state: TriggerState
}

export function MentionPopover(_props: MentionPopoverProps) {
    return null
}
