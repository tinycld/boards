import { describe, expect, it } from 'vitest'
import { rankForAppend, rankForInsert } from '../tinycld/boards/lib/move'
import { initialRanks } from '../tinycld/boards/lib/rank'
import { type AddListSlot, slotBefore } from '../tinycld/boards/stores/boards-ui-store'

// Where a list added from a seam or the column menu actually lands. The slot
// itself is a string key, so these assertions are about ORDERING the resulting
// rank against the board's existing columns — never the key's shape.

interface List {
    id: string
    position: string
}

/** A board of `count` columns with ascending ranks, ids l0..lN. */
function board(count: number): List[] {
    return initialRanks(count).map((position, i) => ({ id: `l${i}`, position }))
}

/**
 * The rank the UI computes for `slot`, mirroring AddListSeam/AddListColumn:
 * `'end'` appends, `before:<id>` inserts at that column's index.
 */
function rankFor(listOrder: List[], slot: AddListSlot): string {
    if (slot === 'end') return rankForAppend(listOrder)
    const beforeId = slot.slice('before:'.length)
    const index = listOrder.findIndex(candidate => candidate.id === beforeId)
    return rankForInsert(listOrder, Math.max(index, 0))
}

/** The board's ids after inserting a new list at `rank`, in render order. */
function orderAfter(listOrder: List[], rank: string): string[] {
    return [...listOrder, { id: 'new', position: rank }]
        .sort((a, b) => {
            if (a.position !== b.position) return a.position < b.position ? -1 : 1
            return a.id < b.id ? -1 : 1
        })
        .map(list => list.id)
}

describe('slotBefore', () => {
    it('is a plain string so store selectors compare by identity', () => {
        expect(slotBefore('l1')).toBe('before:l1')
        expect(slotBefore('l1')).toBe(slotBefore('l1'))
    })

    it('never collides with the trailing rail', () => {
        expect(slotBefore('end')).not.toBe('end')
    })
})

describe('where a slot lands a new list', () => {
    it('puts a list from the leading seam before every column', () => {
        const lists = board(3)
        const rank = rankFor(lists, slotBefore('l0'))
        expect(orderAfter(lists, rank)).toEqual(['new', 'l0', 'l1', 'l2'])
    })

    it('puts a list from a middle seam in exactly that gap', () => {
        const lists = board(3)
        const rank = rankFor(lists, slotBefore('l1'))
        expect(orderAfter(lists, rank)).toEqual(['l0', 'new', 'l1', 'l2'])
    })

    it('appends for the trailing rail', () => {
        const lists = board(3)
        const rank = rankFor(lists, 'end')
        expect(orderAfter(lists, rank)).toEqual(['l0', 'l1', 'l2', 'new'])
    })

    it('lands after the last column when "add list right" hits the end', () => {
        // ColumnMenu maps "right of the last column" to 'end' — there is no
        // neighbour to sit before.
        const lists = board(2)
        const rank = rankFor(lists, 'end')
        expect(orderAfter(lists, rank)).toEqual(['l0', 'l1', 'new'])
    })

    it('lands in the gap, not at a stale index, after the board reorders', () => {
        // The seam names its NEIGHBOUR, so a realtime move that changes every
        // index still resolves to the same visual gap.
        const lists = board(3)
        const reordered = [lists[2], lists[0], lists[1]].map((list, i) => ({
            id: list.id,
            position: initialRanks(3)[i],
        }))
        const rank = rankFor(reordered, slotBefore('l0'))
        expect(orderAfter(reordered, rank)).toEqual(['l2', 'new', 'l0', 'l1'])
    })

    it('keeps consecutive adds at one seam in the order they were typed', () => {
        // The composer stays open so several lists can be typed in a row. Each
        // submit re-reads the board (the insert is optimistic, so the previous
        // one is already there), which is what keeps the second BELOW the first
        // rather than landing them both in the original gap in reverse.
        const lists = board(2)
        const first = rankFor(lists, slotBefore('l1'))
        const withFirst = [...lists, { id: 'first', position: first }]
        const second = rankFor(withFirst, slotBefore('l1'))
        expect(orderAfter(withFirst, second)).toEqual(['l0', 'first', 'new', 'l1'])
    })
})
