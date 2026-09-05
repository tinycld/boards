import { Platform } from 'react-native'

export interface CardRect {
    x: number
    y: number
    width: number
    height: number
}

/**
 * The focused card's viewport rect, for anchoring a canvas picker to it.
 *
 * Measured from the DOM by testID rather than through a ref registry. A ref map
 * would mean every BoardCard registering and unregistering on mount, which is a
 * per-card effect on a component the board deliberately keeps cheap — the focus
 * ring is already read per-card so that a keypress re-renders one card and not
 * the column. Reading the node at keypress time costs nothing until a key is
 * actually pressed.
 *
 * NATIVE returns null: `measureInWindow` is asynchronous, so it cannot answer
 * inside the synchronous keypress handler that needs the rect. That is not a
 * gap — these shortcuts are a hardware-keyboard affordance, and a native menu
 * with no `triggerPosition` falls back to the core Menu's own measurement
 * rather than mispositioning. An iPad with a keyboard opens the picker; it just
 * does not anchor it to the card.
 */
export function focusedCardRect(cardId: string): CardRect | null {
    if (Platform.OS !== 'web') return null
    if (typeof document === 'undefined') return null
    // The card face on the canvas, or the row in the backlog — whichever is
    // on screen for this card.
    const node =
        document.querySelector(`[data-testid="board-card-${cardId}"]`) ??
        document.querySelector(`[data-testid="boards-row-${cardId}"]`)
    if (!node) return null
    const rect = (node as HTMLElement).getBoundingClientRect()
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
}
