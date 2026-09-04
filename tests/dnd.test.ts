import { describe, expect, it } from 'vitest'
import type { EdgeScrollSample } from '~/tinycld/boards/lib/dnd'
import {
    columnDropIndex,
    edgeScrollDirection,
    isCardDragPayload,
    isColumnDragPayload,
    movedEntry,
} from '~/tinycld/boards/lib/dnd'

describe('movedEntry', () => {
    it('recovers a forward move (item dragged toward the end)', () => {
        expect(movedEntry(['a', 'b', 'c', 'd'], ['b', 'c', 'a', 'd'])).toEqual({
            id: 'a',
            index: 2,
        })
    })

    it('recovers a move to the very end', () => {
        expect(movedEntry(['a', 'b', 'c'], ['b', 'c', 'a'])).toEqual({ id: 'a', index: 2 })
    })

    it('recovers a backward move (item dragged toward the start)', () => {
        expect(movedEntry(['a', 'b', 'c', 'd'], ['a', 'd', 'b', 'c'])).toEqual({
            id: 'd',
            index: 1,
        })
    })

    it('recovers a move to the very start', () => {
        expect(movedEntry(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual({ id: 'c', index: 0 })
    })

    it('recovers an adjacent swap as the earlier item moving forward', () => {
        // ['a','b'] → ['b','a'] is ambiguous (either moved); the forward
        // reading writes one rank and produces the same visual order.
        expect(movedEntry(['a', 'b', 'c'], ['b', 'a', 'c'])).toEqual({ id: 'a', index: 1 })
    })

    it('returns null when nothing moved', () => {
        expect(movedEntry(['a', 'b', 'c'], ['a', 'b', 'c'])).toBeNull()
    })

    it('returns null for a single-item list', () => {
        expect(movedEntry(['a'], ['a'])).toBeNull()
    })

    it('returns null when the arrays are different sizes', () => {
        expect(movedEntry(['a', 'b'], ['a'])).toBeNull()
    })
})

describe('columnDropIndex', () => {
    const lists = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

    it('computes before a later column', () => {
        // a removed → [b,c,d]; before c → index 1.
        expect(columnDropIndex(lists, 'a', 'c', 'before')).toBe(1)
    })

    it('computes after a later column', () => {
        expect(columnDropIndex(lists, 'a', 'c', 'after')).toBe(2)
    })

    it('computes before an earlier column', () => {
        // d removed → [a,b,c]; before b → index 1.
        expect(columnDropIndex(lists, 'd', 'b', 'before')).toBe(1)
    })

    it('moves to the far left edge', () => {
        expect(columnDropIndex(lists, 'd', 'a', 'before')).toBe(0)
    })

    it('moves to the far right edge', () => {
        expect(columnDropIndex(lists, 'a', 'd', 'after')).toBe(3)
    })

    it('is null for a drop onto itself', () => {
        expect(columnDropIndex(lists, 'b', 'b', 'before')).toBeNull()
    })

    it('is null for the no-op drop after the left neighbour', () => {
        // b removed → [a,c,d]; after a → index 1 = where b already sits.
        expect(columnDropIndex(lists, 'b', 'a', 'after')).toBeNull()
    })

    it('is null for the no-op drop before the right neighbour', () => {
        expect(columnDropIndex(lists, 'b', 'c', 'before')).toBeNull()
    })

    it('is null for unknown dragged or target ids', () => {
        expect(columnDropIndex(lists, 'zz', 'a', 'before')).toBeNull()
        expect(columnDropIndex(lists, 'a', 'zz', 'before')).toBeNull()
    })
})

describe('edgeScrollDirection', () => {
    const CARD_WIDTH = 272

    /**
     * A monitor-drag sample built the way drax builds one: the hover copy's
     * top-left sits at finger − grabOffset, and the event's hit-test point
     * (dragAbsolutePosition / monitorOffset) is the hover copy's CENTER —
     * which is exactly why the helper cannot use monitorOffset directly.
     * `fingerX` is monitor-relative; `monitorOriginX` places the monitor in
     * root space (e.g. the rail to its left).
     */
    function sample(fingerX: number, grabX: number, monitorOriginX = 0): EdgeScrollSample {
        const fingerRootX = monitorOriginX + fingerX
        const hoverX = fingerRootX - grabX
        const centerRootX = hoverX + CARD_WIDTH / 2
        return {
            dragAbsolutePosition: { x: centerRootX },
            monitorOffset: { x: centerRootX - monitorOriginX },
            dragged: {
                grabOffset: { x: grabX },
                hoverPosition: { x: hoverX },
            },
        }
    }

    it('triggers at the right edge regardless of grab point', () => {
        // Portrait-phone canvas. Grabbed at the card's left edge the hover
        // center leads the finger; grabbed at the right edge it trails by
        // ~136pt — the case the old center-based ratio could never reach.
        expect(edgeScrollDirection(sample(370, 0), 390)).toBe(1)
        expect(edgeScrollDirection(sample(370, CARD_WIDTH), 390)).toBe(1)
    })

    it('triggers at the left edge regardless of grab point', () => {
        expect(edgeScrollDirection(sample(20, 0), 390)).toBe(-1)
        expect(edgeScrollDirection(sample(20, CARD_WIDTH), 390)).toBe(-1)
    })

    it('is idle mid-canvas', () => {
        expect(edgeScrollDirection(sample(195, 0), 390)).toBe(0)
        expect(edgeScrollDirection(sample(195, CARD_WIDTH), 390)).toBe(0)
    })

    it('floors the zone at finger size on narrow viewports', () => {
        // 8% of 390 is ~31pt; 40pt from the edge is outside that ratio zone
        // but inside the 48pt floor.
        expect(edgeScrollDirection(sample(350, 136), 390)).toBe(1)
        expect(edgeScrollDirection(sample(40, 136), 390)).toBe(-1)
    })

    it('uses the ratio zone once it exceeds the floor', () => {
        // 8% of 1000 is 80pt: 60pt from the edge is inside, 90pt is out.
        expect(edgeScrollDirection(sample(940, 136), 1000)).toBe(1)
        expect(edgeScrollDirection(sample(910, 136), 1000)).toBe(0)
    })

    it('is unaffected by the monitor sitting offset in root space', () => {
        const railWidth = 64
        expect(edgeScrollDirection(sample(370, CARD_WIDTH, railWidth), 390)).toBe(1)
        expect(edgeScrollDirection(sample(195, CARD_WIDTH, railWidth), 390)).toBe(0)
        expect(edgeScrollDirection(sample(20, 0, railWidth), 390)).toBe(-1)
    })

    it('is idle before the viewport has measured', () => {
        expect(edgeScrollDirection(sample(370, 0), 0)).toBe(0)
    })
})

describe('payload guards', () => {
    it('isCardDragPayload accepts a card payload', () => {
        expect(isCardDragPayload({ kind: 'boards-card', cardId: 'x', listId: 'y' })).toBe(true)
    })

    it('isCardDragPayload rejects a column payload, and vice versa', () => {
        expect(isCardDragPayload({ kind: 'boards-column', listId: 'y' })).toBe(false)
        expect(isColumnDragPayload({ kind: 'boards-card', cardId: 'x', listId: 'y' })).toBe(false)
    })

    it('isColumnDragPayload accepts a column payload', () => {
        expect(isColumnDragPayload({ kind: 'boards-column', listId: 'y' })).toBe(true)
    })

    it('both reject null, undefined, and foreign objects', () => {
        for (const value of [null, undefined, 'boards-card', 42, {}, { kind: 'drive-items' }]) {
            expect(isCardDragPayload(value)).toBe(false)
            expect(isColumnDragPayload(value)).toBe(false)
        }
    })

    it('tolerates the extra fields SortableItem merges into the payload', () => {
        const merged = {
            kind: 'boards-card',
            cardId: 'x',
            listId: 'y',
            index: 3,
            originalIndex: 2,
            item: {},
        }
        expect(isCardDragPayload(merged)).toBe(true)
    })
})
