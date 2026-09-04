import { describe, expect, it } from 'vitest'
import { selectLinkTargets } from '../tinycld/boards/hooks/useActiveBoard'

/**
 * Which boards the cross-board link picker offers.
 *
 * The rule this pins is easy to get wrong in a way nothing else catches: the
 * card-link create rule is `writerOf(source) && memberOf(target)`
 * (pb-migrations/1980000016), so MEMBERSHIP alone qualifies a board as a
 * target. `useWritableProjects` — which sits right beside this in the same
 * file and looks like the obvious hook to reuse — filters to owner|editor, and
 * using it here would hide boards the server would happily accept.
 *
 * The failure would be quiet: a legitimate target simply absent from the list,
 * reading as "you cannot link there" when in fact you can.
 */
describe('selectLinkTargets', () => {
    const row = (id: string, name: string, role: string, archived = false) => ({
        member: { role },
        project: { id, name, archived },
    })

    // THE case the hook exists for. A viewer cannot edit that board, but the
    // rule only asks that they be a member of it.
    it('includes a board the caller is only a VIEWER of', () => {
        const targets = selectLinkTargets([row('p1', 'Design', 'viewer')])
        expect(targets.map(p => p.id)).toEqual(['p1'])
    })

    it('includes every role, not just the writing ones', () => {
        const targets = selectLinkTargets([
            row('p1', 'Alpha', 'owner'),
            row('p2', 'Beta', 'editor'),
            row('p3', 'Gamma', 'commentor'),
            row('p4', 'Delta', 'viewer'),
        ])
        // Sorted by NAME, so compare as a set — the ordering is the next
        // test's subject, and asserting it here would couple two rules.
        expect(new Set(targets.map(p => p.id))).toEqual(new Set(['p1', 'p2', 'p3', 'p4']))
    })

    // Archived boards are out for a different reason than roles: they are put
    // away, and offering one as a link target would resurrect it by surprise.
    it('excludes archived boards', () => {
        const targets = selectLinkTargets([
            row('p1', 'Live', 'owner'),
            row('p2', 'Old', 'owner', true),
        ])
        expect(targets.map(p => p.id)).toEqual(['p1'])
    })

    it('sorts by name so the list is stable across emissions', () => {
        const targets = selectLinkTargets([
            row('p1', 'Zebra', 'owner'),
            row('p2', 'Alpha', 'viewer'),
            row('p3', 'Middle', 'editor'),
        ])
        expect(targets.map(p => p.name)).toEqual(['Alpha', 'Middle', 'Zebra'])
    })

    it('handles an empty roster', () => {
        expect(selectLinkTargets([])).toEqual([])
    })
})
