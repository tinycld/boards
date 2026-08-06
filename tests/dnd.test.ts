import { describe, expect, it } from 'vitest'
import {
    columnDropIndex,
    isCardDragPayload,
    isColumnDragPayload,
    movedEntry,
} from '~/tinycld/cards/lib/dnd'

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

describe('payload guards', () => {
    it('isCardDragPayload accepts a card payload', () => {
        expect(isCardDragPayload({ kind: 'cards-card', cardId: 'x', listId: 'y' })).toBe(true)
    })

    it('isCardDragPayload rejects a column payload, and vice versa', () => {
        expect(isCardDragPayload({ kind: 'cards-column', listId: 'y' })).toBe(false)
        expect(isColumnDragPayload({ kind: 'cards-card', cardId: 'x', listId: 'y' })).toBe(false)
    })

    it('isColumnDragPayload accepts a column payload', () => {
        expect(isColumnDragPayload({ kind: 'cards-column', listId: 'y' })).toBe(true)
    })

    it('both reject null, undefined, and foreign objects', () => {
        for (const value of [null, undefined, 'cards-card', 42, {}, { kind: 'drive-items' }]) {
            expect(isCardDragPayload(value)).toBe(false)
            expect(isColumnDragPayload(value)).toBe(false)
        }
    })

    it('tolerates the extra fields SortableItem merges into the payload', () => {
        const merged = {
            kind: 'cards-card',
            cardId: 'x',
            listId: 'y',
            index: 3,
            originalIndex: 2,
            item: {},
        }
        expect(isCardDragPayload(merged)).toBe(true)
    })
})
