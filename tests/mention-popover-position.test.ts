// @vitest-environment happy-dom
//
// resolvePosition reads window.innerWidth/innerHeight.
import { beforeEach, describe, expect, it } from 'vitest'
import { resolvePosition } from '../tinycld/cards/components/detail/MentionPopover.web'

// Where the picker lands relative to the caret.
//
// The trap: the popover's height is not known when its position is computed —
// it is sized by however many people match. The estimate exists only to decide
// WHICH WAY to open. Using it to compute a position drew the popover hundreds
// of pixels above the caret, because the estimate is deliberately generous
// (220) while a one-row picker is nearer 70. Flipped above, we therefore pin
// the popover's BOTTOM edge and let it be whatever height it is.

function anchor(top: number, height = 18, left = 100) {
    return { top, left, bottom: top + height, right: left + 2, width: 2, height }
}

describe('mention popover position', () => {
    beforeEach(() => {
        window.innerWidth = 1200
        window.innerHeight = 800
    })

    it('hangs from its top edge when it fits below the caret', () => {
        const pos = resolvePosition(anchor(100))
        expect(pos.top).toBe(122)
        expect(pos.bottom).toBeUndefined()
    })

    // The reported case: a caret low on the page, where the picker must flip.
    it('pins its bottom edge to the caret when it must flip above', () => {
        const pos = resolvePosition(anchor(700))
        // 800 - (700 - 4) = 104 up from the bottom of the viewport.
        expect(pos.bottom).toBe(104)
        expect(pos.top).toBeUndefined()
    })

    it('never runs off the top of the viewport', () => {
        window.innerHeight = 200
        const pos = resolvePosition(anchor(190))
        expect(pos.bottom).toBeGreaterThanOrEqual(8)
    })

    it('keeps the popover on screen at the right edge', () => {
        const pos = resolvePosition(anchor(100, 18, 1190))
        // 1200 - 260 - 8 = 932 is as far right as it may start.
        expect(pos.left).toBe(932)
    })

    it('keeps the popover on screen at the left edge', () => {
        const pos = resolvePosition(anchor(100, 18, -50))
        expect(pos.left).toBe(8)
    })
})
