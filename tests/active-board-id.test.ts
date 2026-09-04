import { describe, expect, it } from 'vitest'
import { resolveActiveProjectId } from '../tinycld/boards/hooks/useActiveBoard'

/**
 * Which board the sidebar highlights and the screen renders.
 *
 * Extracted from useActiveBoard when the sidebar stopped calling that hook —
 * the sidebar needs the board LIST and this resolution, but not the active
 * board's contents, and pulling it in re-rendered an unbounded list on every
 * card edit. Both callers must agree on the answer, which is what makes it
 * worth pinning as a function rather than leaving inline in one of them.
 */
describe('resolveActiveProjectId', () => {
    const live = [{ id: 'p1' }, { id: 'p2' }]
    const archived = [{ id: 'a1' }]

    it('keeps a stored id that still names a live board', () => {
        expect(resolveActiveProjectId('p2', live, archived)).toBe('p2')
    })

    // An archived board is active only by explicit choice — the banner and the
    // sidebar's Archived section are both ways to open one, and neither should
    // bounce the user back to a different board.
    it('keeps a stored id that names an archived board', () => {
        expect(resolveActiveProjectId('a1', live, archived)).toBe('a1')
    })

    // The persisted id may name a board that was deleted, or one this user has
    // since been removed from; both read as "not in either list".
    it('falls back to the first live board when the stored id resolves to nothing', () => {
        expect(resolveActiveProjectId('gone', live, archived)).toBe('p1')
    })

    it('falls back to the first live board on a cold start', () => {
        expect(resolveActiveProjectId(null, live, archived)).toBe('p1')
    })

    // An empty string rather than null: the id feeds queries that disable
    // themselves on a falsy value, and '' keeps that contract in one type.
    it('yields an empty id when there are no live boards at all', () => {
        expect(resolveActiveProjectId(null, [], [])).toBe('')
    })

    // The archived-only case: nothing to fall back TO, so a stored archived id
    // is the only thing keeping the board on screen.
    it('does not fall back past an archived board when it is the only one', () => {
        expect(resolveActiveProjectId('a1', [], archived)).toBe('a1')
    })
})
