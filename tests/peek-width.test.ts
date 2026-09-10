import { describe, expect, it } from 'vitest'
import { clampPeekWidth, PEEK_MIN_WIDTH } from '../tinycld/boards/lib/peek-width'

/**
 * The clamp is what stands between a stored width and the screen it lands on.
 * It runs on the render path, so the value it is handed may have been set on a
 * different monitor entirely — the cases below are that trip.
 */
describe('clampPeekWidth', () => {
    it('floors at the width the peek has always been', () => {
        // 500 is today's fixed PEEK_WIDTH. Nothing may get narrower than what
        // is already on screen.
        expect(clampPeekWidth(120, 1920)).toBe(PEEK_MIN_WIDTH)
        expect(clampPeekWidth(0, 1920)).toBe(PEEK_MIN_WIDTH)
    })

    it('passes a width through untouched when it fits', () => {
        expect(clampPeekWidth(900, 1920)).toBe(900)
    })

    it('caps a width at a fraction of the window, not a fixed ceiling', () => {
        // 60% of 1280 is 768, so a peek dragged wider on a big monitor shows
        // at 768 here rather than swallowing the board.
        expect(clampPeekWidth(900, 1280)).toBe(768)
    })

    it('lets the floor win on a window too narrow for the fraction', () => {
        // 60% of 700 is 420 — below the minimum. A peek that shrank past 500
        // would be worse than one that covers more of the board than the
        // fraction intends.
        expect(clampPeekWidth(900, 700)).toBe(PEEK_MIN_WIDTH)
        expect(clampPeekWidth(PEEK_MIN_WIDTH, 700)).toBe(PEEK_MIN_WIDTH)
    })

    it('does not rewrite the stored width, so a wide monitor gets it back', () => {
        // The clamp is a display-time function: the same input, clamped for a
        // laptop, still yields the full width once the window is wide again.
        const stored = 900
        expect(clampPeekWidth(stored, 1280)).toBe(768)
        expect(clampPeekWidth(stored, 1920)).toBe(stored)
    })
})
