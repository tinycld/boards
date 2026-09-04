import { describe, expect, it } from 'vitest'
import {
    groupReactions,
    isReactionEmoji,
    REACTION_KEYS,
    REACTION_LABELS,
    REACTION_PALETTE,
} from '../tinycld/cards/lib/reactions'

function row(id: string, comment: string, user: string, emoji: string) {
    return { id, comment, user, emoji }
}

describe('groupReactions', () => {
    it('counts per comment and emoji, in palette order, and finds the caller’s own row', () => {
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

    it('never claims a row for an anonymous viewer', () => {
        const groups = groupReactions([row('r1', 'c1', '', '👍')], '')
        expect(groups.get('c1')?.[0]?.ownId).toBeNull()
    })

    it('drops an emoji outside the palette rather than rendering it nameless', () => {
        expect(groupReactions([row('r1', 'c1', 'u1', '🦄')], 'u1').size).toBe(0)
    })

    it('is empty for no rows', () => {
        expect(groupReactions([], 'u1').size).toBe(0)
    })
})

describe('palette', () => {
    it('names every emoji once', () => {
        for (const emoji of REACTION_PALETTE) {
            expect(isReactionEmoji(emoji)).toBe(true)
            expect(REACTION_KEYS[emoji]).toMatch(/^[a-z_]+$/)
            expect(REACTION_LABELS[emoji]).toBeTruthy()
        }
        expect(new Set(Object.values(REACTION_KEYS)).size).toBe(REACTION_PALETTE.length)
        expect(isReactionEmoji('🦄')).toBe(false)
    })
})
