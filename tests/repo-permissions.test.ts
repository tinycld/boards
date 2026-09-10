import { describe, expect, it } from 'vitest'
import { canRemoveRepo } from '../tinycld/boards/lib/repo-permissions'

describe('canRemoveRepo', () => {
    it("allows removal when the caller owns the repo row's own project", () => {
        const ownedProjectIds = new Set(['board-a'])
        expect(canRemoveRepo(ownedProjectIds, 'board-a')).toBe(true)
    })

    it('refuses removal on a project the caller does not own, even when they own another', () => {
        // The exact regression the task-12 review caught: owning board A must
        // not grant Remove on board B's repo row.
        const ownedProjectIds = new Set(['board-a'])
        expect(canRemoveRepo(ownedProjectIds, 'board-b')).toBe(false)
    })

    it('refuses removal when the caller owns nothing', () => {
        const ownedProjectIds = new Set<string>()
        expect(canRemoveRepo(ownedProjectIds, 'board-a')).toBe(false)
    })

    it('allows removal on any project in a multi-board owned set', () => {
        const ownedProjectIds = new Set(['board-a', 'board-b'])
        expect(canRemoveRepo(ownedProjectIds, 'board-b')).toBe(true)
    })
})
