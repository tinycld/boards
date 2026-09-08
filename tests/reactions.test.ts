import { describe, expect, it } from 'vitest'
import { groupReactions, reactionFromKey, reactionKey } from '../tinycld/boards/lib/reactions'

function row(id: string, comment: string, user: string, emoji: string) {
    return { id, comment, user, emoji }
}

describe('groupReactions', () => {
    it('counts per comment and emoji, and finds the caller’s own row', () => {
        const groups = groupReactions(
            [
                row('r1', 'c1', 'u2', '🚀'),
                row('r2', 'c1', 'u1', '👍'),
                row('r3', 'c1', 'u2', '👍'),
                row('r4', 'c2', 'u1', '❤️'),
            ],
            'u1'
        )
        expect(groups.get('c1')).toEqual([
            { emoji: '👍', count: 2, ownId: 'r2' },
            { emoji: '🚀', count: 1, ownId: null },
        ])
        expect(groups.get('c2')).toEqual([{ emoji: '❤️', count: 1, ownId: 'r4' }])
        expect(groups.get('c3')).toBeUndefined()
    })

    it('orders by count, not by arrival', () => {
        // There is no palette order to fall back on any more.
        const groups = groupReactions(
            [
                row('r1', 'c1', 'u1', '🐌'),
                row('r2', 'c1', 'u2', '🚀'),
                row('r3', 'c1', 'u3', '🚀'),
                row('r4', 'c1', 'u4', '🚀'),
                row('r5', 'c1', 'u5', '🎉'),
                row('r6', 'c1', 'u6', '🎉'),
            ],
            ''
        )
        expect(groups.get('c1')?.map(g => g.emoji)).toEqual(['🚀', '🎉', '🐌'])
    })

    it('breaks ties on first appearance, so equal counts do not shuffle', () => {
        const rows = [
            row('r1', 'c1', 'u1', '👀'),
            row('r2', 'c1', 'u2', '👍'),
            row('r3', 'c1', 'u3', '🎉'),
        ]
        expect(
            groupReactions(rows, '')
                .get('c1')
                ?.map(g => g.emoji)
        ).toEqual(['👀', '👍', '🎉'])
    })

    it('accepts any emoji, because the server decides what is storable', () => {
        // The old palette filter dropped anything outside the six. With an
        // open vocabulary the guard in server/reaction_emoji.go is the only
        // gate, so nothing is dropped here.
        const groups = groupReactions(
            [row('r1', 'c1', 'u1', '🦄'), row('r2', 'c1', 'u2', '🏳️‍🌈')],
            'u1'
        )
        expect(groups.get('c1')?.map(g => g.emoji)).toEqual(['🦄', '🏳️‍🌈'])
    })

    it('treats a skin tone as its own reaction', () => {
        // The chosen semantics: 👍 and 👍🏽 count separately.
        const groups = groupReactions(
            [row('r1', 'c1', 'u1', '👍'), row('r2', 'c1', 'u2', '👍🏽')],
            ''
        )
        expect(groups.get('c1')).toHaveLength(2)
    })

    it('never claims a row for an anonymous reader', () => {
        const groups = groupReactions([row('r1', 'c1', 'u1', '👍')], '')
        expect(groups.get('c1')?.[0].ownId).toBeNull()
    })

    it('returns nothing for no rows', () => {
        expect(groupReactions([], 'u1').size).toBe(0)
    })
})

describe('reactionKey', () => {
    it('is the unified codepoints, so a selector never carries a raw glyph', () => {
        expect(reactionKey('👍')).toBe('1f44d')
        expect(reactionKey('❤️')).toBe('2764-fe0f')
        expect(reactionKey('👍🏽')).toBe('1f44d-1f3fd')
    })

    it('distinguishes a toned emoji from its base', () => {
        expect(reactionKey('👍')).not.toBe(reactionKey('👍🏽'))
    })

    it('round-trips through reactionFromKey', () => {
        for (const emoji of ['👍', '❤️', '👍🏽', '🏳️‍🌈', '🦄']) {
            expect(reactionFromKey(reactionKey(emoji))).toBe(emoji)
        }
    })
})
