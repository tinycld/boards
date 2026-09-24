import { describe, expect, it } from 'vitest'
import { highestRole } from '../tinycld/boards/lib/highest-role'

describe('highestRole', () => {
    it('returns null with no rows', () => {
        expect(highestRole([])).toBeNull()
    })
    it('prefers the stronger role across a direct and a derived row', () => {
        expect(highestRole(['viewer', 'editor'])).toBe('editor')
        expect(highestRole(['commentor', 'viewer'])).toBe('commentor')
        expect(highestRole(['editor', 'owner', 'viewer'])).toBe('owner')
    })
    it('returns the single role unchanged', () => {
        expect(highestRole(['viewer'])).toBe('viewer')
    })
})
