import { describe, expect, it } from 'vitest'
import { byCreatedThenId } from '../tinycld/boards/lib/created-order'

const row = (id: string, created: string) => ({ id, created })

describe('byCreatedThenId', () => {
    it('orders oldest first', () => {
        const sorted = [row('b', '2026-08-05T10:01:00Z'), row('a', '2026-08-05T10:00:00Z')].sort(
            byCreatedThenId
        )
        expect(sorted.map(r => r.id)).toEqual(['a', 'b'])
    })

    it('sorts an optimistic (empty created) row last regardless of comparator slot', () => {
        const optimistic = row('opt', '')
        const persisted = row('old', '2026-08-05T10:00:00Z')
        expect(byCreatedThenId(optimistic, persisted)).toBeGreaterThan(0)
        expect(byCreatedThenId(persisted, optimistic)).toBeLessThan(0)
        expect([optimistic, persisted].sort(byCreatedThenId).map(r => r.id)).toEqual(['old', 'opt'])
    })

    it('tie-breaks equal timestamps on id', () => {
        const sorted = [row('z', '2026-08-05T10:00:00Z'), row('a', '2026-08-05T10:00:00Z')].sort(
            byCreatedThenId
        )
        expect(sorted.map(r => r.id)).toEqual(['a', 'z'])
    })

    it('never throws for rows built with the ??-empty normalization', () => {
        // The reply-save crash shape: an optimistic insert draft has NO
        // created; the map normalizes it to ''. Pin that the normalized pair
        // sorts instead of throwing, in every arrangement.
        const record: { id: string; created?: string } = { id: 'opt' }
        const optimistic = row(record.id, record.created ?? '')
        const rows = [
            row('a', '2026-08-05T10:00:00Z'),
            row('b', '2026-08-05T10:01:00Z'),
            optimistic,
        ]
        expect(() => [...rows].reverse().sort(byCreatedThenId)).not.toThrow()
        expect([...rows].sort(byCreatedThenId).at(-1)?.id).toBe('opt')
    })

    it('keeps two optimistic rows in id order', () => {
        const sorted = [row('opt-b', ''), row('opt-a', '')].sort(byCreatedThenId)
        expect(sorted.map(r => r.id)).toEqual(['opt-a', 'opt-b'])
    })
})
