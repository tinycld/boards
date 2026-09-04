import { describe, expect, it } from 'vitest'
import {
    buildCommentMentionRows,
    mentionedUserIds,
    renderMentionTokens,
} from '../tinycld/boards/lib/mention-text'

const NAMES = [
    { userId: 'u1', label: 'Ada Lovelace' },
    { userId: 'u2', label: 'Grace Hopper' },
]

describe('renderMentionTokens', () => {
    it('replaces a token with the member name', () => {
        expect(renderMentionTokens('ping [[@u1]] please', NAMES)).toBe('ping @Ada Lovelace please')
    })

    it('replaces every occurrence, including repeats', () => {
        expect(renderMentionTokens('[[@u1]] and [[@u2]] and [[@u1]]', NAMES)).toBe(
            '@Ada Lovelace and @Grace Hopper and @Ada Lovelace'
        )
    })

    // A record id leaking into readable prose is worse than an honest
    // placeholder. Only reachable for a LEGACY token that carries no name —
    // one written before the format included it.
    it('renders an unknown id as a neutral placeholder, never the raw id', () => {
        const out = renderMentionTokens('who is [[@ghost]]', NAMES)
        expect(out).toBe('who is @someone')
        expect(out).not.toContain('ghost')
        expect(out).not.toContain('[[@')
    })

    // The reason the token carries a name at all: someone leaving the board
    // must not erase their name from the sentence that mentions them.
    it('falls back to the name in the token when the roster cannot resolve the id', () => {
        const out = renderMentionTokens('who is [[@gone|Grace Hopper]]', NAMES)
        expect(out).toBe('who is @Grace Hopper')
        expect(out).not.toContain('@someone')
    })

    // The roster is live, so a rename is reflected without rewriting stored text.
    it('prefers the roster name over the one stored in the token', () => {
        expect(renderMentionTokens('ping [[@u1|Stale Name]]', NAMES)).toBe('ping @Ada Lovelace')
    })

    // `]` and `|` are percent-encoded by the writer — they would otherwise end
    // the token early and spill the rest of the name into the comment. They
    // come back as literal characters, then get markdown-escaped on the way
    // into the body (see the injection cases below).
    it('decodes delimiters a user could type into their own name', () => {
        expect(renderMentionTokens('hi [[@gone|a%5Db%7Cc]]', NAMES)).toBe(String.raw`hi @a\]b\|c`)
    })

    // A display name is user-controlled (users.updateRule lets anyone set their
    // own), and the rendered name lands in markdown SOURCE. Unescaped, the name
    // is markup in someone else's card.
    describe('markdown injection through a display name', () => {
        it('does not let a name become a link', () => {
            const out = renderMentionTokens('hi [[@u1]]', [
                { userId: 'u1', label: '[click](javascript:alert(1))' },
            ])
            expect(out).not.toContain('](')
        })

        it('does not let a name become an image', () => {
            // Worse than a link: no tap needed. The reader's client fetches it
            // on render, so this would be a tracking pixel in every card that
            // mentions its owner.
            const out = renderMentionTokens('hi [[@u1]]', [
                { userId: 'u1', label: '![x](https://evil.test/track.png)' },
            ])
            expect(out).not.toContain('![')
            expect(out).not.toContain('](')
        })

        it('does not let a name emphasise the surrounding sentence', () => {
            const out = renderMentionTokens('hi [[@u1]] there', [{ userId: 'u1', label: '*Ada*' }])
            expect(out).toBe(String.raw`hi @\*Ada\* there`)
        })

        it('leaves an ordinary name readable', () => {
            expect(renderMentionTokens('ping [[@u1]]', NAMES)).toBe('ping @Ada Lovelace')
        })
    })

    it('still notifies the id when the token carries a name', () => {
        expect(mentionedUserIds('hi [[@u1|Ada Lovelace]]')).toEqual(['u1'])
    })

    it('leaves text with no tokens untouched', () => {
        const body = 'an ordinary description with an email a@b.com'
        expect(renderMentionTokens(body, NAMES)).toBe(body)
    })

    it('ignores malformed tokens', () => {
        for (const body of ['[@u1]', '[[u1]]', '[[@]]', '[[@bad id]]']) {
            expect(renderMentionTokens(body, NAMES)).toBe(body)
        }
    })

    // The rich editor serializes to MARKDOWN, where `[` is syntax, so a token
    // inserted by the picker is stored with escaped brackets. Both spellings
    // are the same mention. Matching only the bare form left raw tokens on
    // screen in every posted comment — caught by card-mentions.spec.ts, and
    // the fast-path guard (`[[@` vs `[@`) was the actual culprit.
    it('substitutes a markdown-escaped token', () => {
        expect(renderMentionTokens(String.raw`hi \[\[@u1\]\]`, NAMES)).toBe('hi @Ada Lovelace')
    })

    it('handles an empty body and an empty roster', () => {
        expect(renderMentionTokens('', NAMES)).toBe('')
        expect(renderMentionTokens('hi [[@u1]]', [])).toBe('hi @someone')
    })
})

describe('mentionedUserIds', () => {
    it('returns distinct ids in order of first appearance', () => {
        expect(mentionedUserIds('[[@u2]] [[@u1]] [[@u2]]')).toEqual(['u2', 'u1'])
    })

    it('reads ids from the escaped spelling too', () => {
        expect(mentionedUserIds(String.raw`\[\[@u1\]\] and [[@u2]]`)).toEqual(['u1', 'u2'])
    })

    it('returns nothing for a body with no mentions', () => {
        expect(mentionedUserIds('plain text')).toEqual([])
    })

    // The Go twin (server/description_mentions.go) must agree with this, since
    // the two parse the same stored text on either side of the wire.
    it('accepts the id shapes PocketBase actually mints', () => {
        expect(mentionedUserIds('[[@abc123XYZ_-]]')).toEqual(['abc123XYZ_-'])
    })
})

describe('buildCommentMentionRows', () => {
    const base = { commentId: 'c1', cardId: 'card1', authorId: 'me' }

    it('builds one row per distinct mention', () => {
        const rows = buildCommentMentionRows({ ...base, body: 'hi [[@u1]] and [[@u2]]' })
        expect(rows.map(r => r.mentioned_user)).toEqual(['u1', 'u2'])
    })

    it('deduplicates a user mentioned twice', () => {
        const rows = buildCommentMentionRows({ ...base, body: '[[@u1]] hi [[@u1]]' })
        expect(rows).toHaveLength(1)
    })

    // Notifying yourself is noise; the Go hook drops it too, so this is the
    // client half of a defence held on both sides.
    it('skips a self-mention', () => {
        const rows = buildCommentMentionRows({ ...base, body: 'note to [[@me]] and [[@u1]]' })
        expect(rows.map(r => r.mentioned_user)).toEqual(['u1'])
    })

    it('returns nothing when there are no mentions', () => {
        expect(buildCommentMentionRows({ ...base, body: 'just a comment' })).toEqual([])
    })

    // The target is the CARD, not the comment: a mention is about the card you
    // are being called to, and that is what the deep-link opens.
    it('targets the card and leaves drive_item empty', () => {
        const [row] = buildCommentMentionRows({ ...base, body: '[[@u1]]' })
        expect(row).toMatchObject({
            comment_collection: 'boards_comments',
            comment_record: 'c1',
            target_collection: 'boards_cards',
            target_record: 'card1',
            drive_item: '',
        })
    })

    // An anonymous author (the public board) must not make every mention a
    // self-mention by matching the '' fallback.
    it('does not treat an empty author id as matching a real user', () => {
        const rows = buildCommentMentionRows({ ...base, authorId: '', body: '[[@u1]]' })
        expect(rows).toHaveLength(1)
    })
})
