import { describe, expect, it } from 'vitest'
import {
    deriveSlug,
    formatCardKey,
    MAX_SLUG_LENGTH,
    parseCardKey,
} from '../tinycld/cards/lib/card-key'

// The key grammar. cli/key.go implements the same one in Go with no shared
// fixture between them, so a change here needs a matching change in
// cli/key_test.go — these two tables are the only thing holding the CLI and the
// app to one spelling of OTTER-123.

describe('formatCardKey', () => {
    it('joins a slug and a number', () => {
        expect(formatCardKey('OTTER', 123)).toBe('OTTER-123')
    })

    // The optimistic-insert gap: a card is in the local store before the server
    // assigns its number, and `number` reads 0 until the echo lands. The empty
    // string is what makes every call site render nothing without a null check.
    it('returns empty for an unassigned number', () => {
        expect(formatCardKey('OTTER', 0)).toBe('')
    })

    // A board created without a slug — the column is optional on purpose.
    it('returns empty for a board with no slug', () => {
        expect(formatCardKey('', 12)).toBe('')
    })

    it('returns empty for a nonsense number', () => {
        expect(formatCardKey('OTTER', Number.NaN)).toBe('')
        expect(formatCardKey('OTTER', -3)).toBe('')
    })
})

describe('parseCardKey', () => {
    it('parses a key', () => {
        expect(parseCardKey('OTTER-123')).toEqual({ slug: 'OTTER', number: 123 })
    })

    // A key typed into a URL bar or pasted from chat arrives in whatever case
    // the writer used; both spellings must reach the same card.
    it('uppercases the slug so lowercase input resolves', () => {
        expect(parseCardKey('otter-123')).toEqual({ slug: 'OTTER', number: 123 })
    })

    it('tolerates surrounding whitespace', () => {
        expect(parseCardKey('  OTTER-7  ')).toEqual({ slug: 'OTTER', number: 7 })
    })

    // This is what lets the route resolver ask "is this a key?" of a raw record
    // id without a try/catch — a PocketBase id has no hyphen.
    it('returns null for a raw record id', () => {
        expect(parseCardKey('r8f3k2m9x1p7q4w')).toBeNull()
    })

    // Accepting these would give one card two spellings that both resolve, with
    // neither canonical.
    it('rejects leading zeros', () => {
        expect(parseCardKey('OTTER-007')).toBeNull()
    })

    it('rejects a zero or negative number', () => {
        expect(parseCardKey('OTTER-0')).toBeNull()
        expect(parseCardKey('OTTER--3')).toBeNull()
    })

    it('rejects a slug longer than the column allows', () => {
        expect(parseCardKey(`${'A'.repeat(MAX_SLUG_LENGTH + 1)}-1`)).toBeNull()
    })

    it('rejects punctuation in the slug', () => {
        expect(parseCardKey('OT TER-1')).toBeNull()
        expect(parseCardKey('OT_TER-1')).toBeNull()
    })

    it('round-trips whatever formatCardKey produced', () => {
        expect(parseCardKey(formatCardKey('OTTER', 42))).toEqual({ slug: 'OTTER', number: 42 })
    })
})

describe('deriveSlug', () => {
    // How people abbreviate a project out loud.
    it('takes initials from a multi-word name', () => {
        expect(deriveSlug('Product Launch')).toBe('PL')
        expect(deriveSlug('Q3 Platform Engineering')).toBe('QPE')
    })

    it('takes the whole word when there is only one', () => {
        expect(deriveSlug('Roadmap')).toBe('ROADMAP')
        expect(deriveSlug('otter')).toBe('OTTER')
    })

    it('truncates to the column limit', () => {
        expect(deriveSlug('Extraordinarily')).toBe('EXTRAORDIN')
        expect(deriveSlug('Extraordinarily').length).toBeLessThanOrEqual(MAX_SLUG_LENGTH)
    })

    it('folds diacritics rather than dropping the letter', () => {
        expect(deriveSlug('Café')).toBe('CAFE')
    })

    it('ignores punctuation between words', () => {
        expect(deriveSlug('Product — Launch!')).toBe('PL')
    })

    // The dialog leaves the field empty rather than suggesting a key nobody can
    // disambiguate; the board is then created without one.
    it('returns empty rather than a one-character suggestion', () => {
        expect(deriveSlug('X')).toBe('')
        expect(deriveSlug('!!!')).toBe('')
        expect(deriveSlug('')).toBe('')
    })

    it('always produces something parseCardKey accepts', () => {
        for (const name of ['Product Launch', 'Roadmap', 'Café', 'Q3 Platform Engineering']) {
            const slug = deriveSlug(name)
            expect(parseCardKey(`${slug}-1`)).toEqual({ slug, number: 1 })
        }
    })
})
