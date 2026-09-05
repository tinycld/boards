/**
 * Pure selection-gesture logic, split out from useCardSelection so the press
 * rules can be unit-tested without a store or hook harness (mirrors how dnd.ts
 * holds the pure drop rules).
 *
 * Adapted from drive's lib/selection-gesture.ts rather than imported: siblings
 * must not depend on each other, and this is pure logic with no boards- or
 * drive-specific content.
 *
 * ONE RULE CARRIED OVER VERBATIM, because it came at real cost: the decision is
 * made on the CLICK (release), never on press-down. Drive originally selected on
 * pointerdown for an instant highlight and hit a CI failure where a Ctrl+click
 * whose pointerdown reported `ctrlKey:false` fell through and REPLACED the
 * selection instead of extending it — the modifier flag is not reliably present
 * on pointerdown under load. Boards has no reason to select on press-down at
 * all (a plain press opens the peek, and that already happens on release so a
 * drag beginning on a card never opens it), so there is a single entry point
 * and the unreliable event is simply never consulted.
 */

/** Which modifier keys were held during the gesture (web only). */
export interface SelectionModifiers {
    /** cmd (mac) — toggles a single card in/out of the selection. */
    meta: boolean
    /** ctrl (win/linux) — same as meta. */
    ctrl: boolean
    /** shift — extends a contiguous range from the anchor. */
    shift: boolean
}

/**
 * The selection mutation a gesture resolves to. The hook maps each variant onto
 * the matching store action; keeping it data lets the decision be asserted
 * directly.
 *   - `open`   — not a selection gesture at all: open the card (the peek)
 *   - `single` — select only this card
 *   - `toggle` — add/remove this card from the selection
 *   - `range`  — extend a range from the anchor to this card
 */
export type SelectionAction =
    | { type: 'open' }
    | { type: 'single' }
    | { type: 'toggle' }
    | { type: 'range' }

/**
 * Selection action for a release/CLICK (onPress) on web:
 *   - meta/ctrl click → toggle (add/remove from the selection)
 *   - shift click     → range (extend from the anchor)
 *   - plain click while a selection stands → single (collapse to this one card,
 *     the way a file manager does; the selection is the mode, so a plain click
 *     inside one re-aims it rather than opening a card)
 *   - otherwise → open (the ordinary, no-selection case: show the peek)
 */
export function clickAction(
    modifiers: SelectionModifiers,
    selectedIds: ReadonlySet<string>
): SelectionAction {
    if (modifiers.meta || modifiers.ctrl) return { type: 'toggle' }
    if (modifiers.shift) return { type: 'range' }
    if (selectedIds.size > 0) return { type: 'single' }
    return { type: 'open' }
}
