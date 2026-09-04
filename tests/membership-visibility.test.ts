import { describe, expect, it } from 'vitest'
import { visibilityChanges } from '../tinycld/boards/lib/membership-visibility'

// The decision table behind useMembershipVisibilitySync: which projects to
// pull in (granted) or drop out (revoked) when MY membership set changes. The
// store predicate stands in for "does the local synced layer already hold
// this project" — the discriminator between a grant from someone else
// (project unknown, rows just became readable out there) and my own board
// create (project optimistically inserted by the same mutation that made the
// membership row).

const inStore = (ids: string[]) => (id: string) => ids.includes(id)

describe('visibilityChanges', () => {
    it('a grant for an unknown project needs pulling', () => {
        expect(visibilityChanges(['a'], ['a', 'b'], inStore(['a']))).toEqual({
            granted: ['b'],
            revoked: [],
        })
    })

    it('my own board create needs nothing — its rows are already local', () => {
        expect(visibilityChanges(['a'], ['a', 'b'], inStore(['a', 'b']))).toEqual({
            granted: [],
            revoked: [],
        })
    })

    it('a revocation of a project the store still holds needs dropping', () => {
        expect(visibilityChanges(['a', 'b'], ['a'], inStore(['a', 'b']))).toEqual({
            granted: [],
            revoked: ['b'],
        })
    })

    it('a disappearance the store already reconciled needs nothing', () => {
        // e.g. the whole board was deleted: the project delete event landed
        // first and removed the row, then the cascaded member-row delete
        // arrives — nothing left to drop.
        expect(visibilityChanges(['a', 'b'], ['a'], inStore(['a']))).toEqual({
            granted: [],
            revoked: [],
        })
    })

    it('an unchanged set needs nothing, whatever the store holds', () => {
        expect(visibilityChanges(['a', 'b'], ['b', 'a'], inStore(['a']))).toEqual({
            granted: [],
            revoked: [],
        })
        expect(visibilityChanges([], [], inStore([]))).toEqual({ granted: [], revoked: [] })
    })

    it('a simultaneous grant and revocation reports each side independently', () => {
        // Swapped boards: lost 'a' (still local), gained 'c' (unknown).
        expect(visibilityChanges(['a'], ['c'], inStore(['a']))).toEqual({
            granted: ['c'],
            revoked: ['a'],
        })
        // The store already agrees on both — nothing to do in either
        // direction.
        expect(visibilityChanges(['a'], ['c'], inStore(['c']))).toEqual({
            granted: [],
            revoked: [],
        })
    })

    it('the first membership ever still pulls on a fresh store', () => {
        expect(visibilityChanges([], ['a'], inStore([]))).toEqual({ granted: ['a'], revoked: [] })
    })
})
