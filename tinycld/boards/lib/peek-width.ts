/**
 * The peek's width: what the user dragged to, and what may actually be shown.
 *
 * The stored value is the RAW width, never the clamped one. A width set on a
 * large monitor has to survive a trip through a laptop — clamping on the way
 * IN would let one afternoon of narrow-window use permanently shrink a peek
 * the user sized deliberately.
 *
 *     stored 900 → 1920px window: 900  (under the cap)
 *                → 1280px window: 768  (clamped for display only)
 *                → back to 1920:  900  (the stored value was never rewritten)
 *
 * Only the render path clamps a value it did not produce; a live drag clamps
 * against the window the user is dragging on, so a deliberate resize there
 * does replace the stored value.
 *
 * React-free and in `lib/` for the reason board-route.ts is: it is the part
 * worth testing, and a pure function needs no hook harness to test it.
 */

/** Today's fixed panel width, which becomes the floor — nothing shrinks. */
export const PEEK_MIN_WIDTH = 500

/** How much of the board the peek may cover before it stops being a peek. */
const MAX_VIEWPORT_FRACTION = 0.6

export function clampPeekWidth(width: number, windowWidth: number): number {
    // The floor wins over the fraction: on a narrow window 60% falls below the
    // minimum, and a peek that shrank past 500px would be worse than one that
    // covers more of the board than the fraction intends.
    const max = Math.max(PEEK_MIN_WIDTH, windowWidth * MAX_VIEWPORT_FRACTION)
    return Math.min(Math.max(width, PEEK_MIN_WIDTH), max)
}
