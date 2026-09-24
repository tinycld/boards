import { describe, expect, it } from 'vitest'
import { uniqueByUserId } from '../tinycld/boards/lib/unique-by-user-id'

describe('uniqueByUserId', () => {
    it('returns an empty array for no rows', () => {
        expect(uniqueByUserId([])).toEqual([])
    })

    it('keeps the first row when a user appears twice', () => {
        const direct = { user: { id: 'u1' }, source: 'direct' }
        const group = { user: { id: 'u1' }, source: 'group' }
        expect(uniqueByUserId([direct, group])).toEqual([direct])
    })

    it('keeps one row per distinct user', () => {
        const a = { user: { id: 'u1' } }
        const b = { user: { id: 'u2' } }
        expect(uniqueByUserId([a, b])).toEqual([a, b])
    })
})
