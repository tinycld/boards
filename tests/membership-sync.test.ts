import { describe, expect, it } from 'vitest'
import { revokedProjectIds } from '../tinycld/boards/lib/membership-sync'

describe('revokedProjectIds', () => {
    it('names the boards the membership set stopped naming', () => {
        expect(revokedProjectIds(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b'])
    })

    it('a grant is nothing to drop', () => {
        expect(revokedProjectIds(['a'], ['a', 'b'])).toEqual([])
    })

    it('ignores the empty id an empty key splits into', () => {
        expect(revokedProjectIds([''], ['a'])).toEqual([])
    })
})
