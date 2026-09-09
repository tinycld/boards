import { describe, expect, it } from 'vitest'
import {
    groupCardReactions,
    groupCommentReactions,
    reactionFromKey,
    reactionKey,
    reactorNameLookup,
} from '../tinycld/boards/lib/reactions'

// The fold itself — ordering, tie-breaking, own-row, skin tones — is core's
// and is tested there (core/lib/reactions/__tests__/group.test.ts). What is
// boards' own is which column each table is keyed by, and how a reactor id
// becomes a name.

const commentRow = (id: string, comment: string, user: string, emoji: string) => ({
    id,
    comment,
    user,
    emoji,
})
const cardRow = (id: string, card: string, user: string, emoji: string) => ({
    id,
    card,
    user,
    emoji,
})

describe('groupCommentReactions', () => {
    it('keys by comment, so two comments never share a bar', () => {
        const groups = groupCommentReactions(
            [
                commentRow('r1', 'c1', 'u1', '👍'),
                commentRow('r2', 'c1', 'u2', '👍'),
                commentRow('r3', 'c2', 'u1', '👍'),
            ],
            'u1'
        )
        expect(groups.get('c1')?.[0].count).toBe(2)
        expect(groups.get('c2')?.[0].count).toBe(1)
    })

    it('carries the reactor ids the tooltip names', () => {
        const groups = groupCommentReactions(
            [commentRow('r1', 'c1', 'u1', '👍'), commentRow('r2', 'c1', 'u2', '👍')],
            'u1'
        )
        expect(groups.get('c1')?.[0].userIds).toEqual(['u1', 'u2'])
        expect(groups.get('c1')?.[0].ownId).toBe('r1')
    })
})

describe('groupCardReactions', () => {
    it('keys by card', () => {
        const groups = groupCardReactions(
            [
                cardRow('r1', 'card1', 'u1', '🚀'),
                cardRow('r2', 'card1', 'u2', '🚀'),
                cardRow('r3', 'card2', 'u1', '👍'),
            ],
            'u2'
        )
        expect(groups.get('card1')?.[0]).toMatchObject({
            emoji: '🚀',
            count: 2,
            ownId: 'r2',
        })
        expect(groups.get('card2')?.[0].ownId).toBeNull()
    })
})

describe('reactorNameLookup', () => {
    const members = new Map([
        ['u1', { id: 'u1', firstName: 'Nathan', lastName: 'Stitt' }],
        ['u2', { id: 'u2', firstName: 'Sam', lastName: '' }],
    ])

    it('names a member the caller can read', () => {
        expect(reactorNameLookup(members)('u1')).toBe('Nathan Stitt')
    })

    it('does not leave a trailing space on a one-word name', () => {
        expect(reactorNameLookup(members)('u2')).toBe('Sam')
    })

    it('falls back to the anonymous placeholder for an unreadable id', () => {
        // A share-link visitor reads reactions but not the users behind them.
        // Same placeholder assignees already use, so nothing new is disclosed.
        expect(reactorNameLookup(members)('someone-else')).toBe('Board member')
    })
})

describe('reactionKey', () => {
    it('is the unified codepoints, so a selector never carries a raw glyph', () => {
        expect(reactionKey('👍')).toBe('1f44d')
        expect(reactionKey('👍🏽')).toBe('1f44d-1f3fd')
    })

    it('round-trips through reactionFromKey', () => {
        for (const emoji of ['👍', '❤️', '👍🏽', '🏳️‍🌈', '🦄']) {
            expect(reactionFromKey(reactionKey(emoji))).toBe(emoji)
        }
    })
})
