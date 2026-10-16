import { appHref } from '@tinycld/core/lib/org-routes'
import type { Href } from 'expo-router'
import { describe, expect, it } from 'vitest'
import {
    activeBoardIdFromPath,
    boardHref,
    boardPath,
    boardSegment,
    cardHref,
    cardPagePath,
    isCoveredByBoard,
    parseBoardSegment,
    parseCardNumber,
    parseCardSegment,
    peekHref,
    peekSegment,
} from '../tinycld/boards/lib/board-route'

/**
 * The URL is the source of truth for which board is open and which card is
 * peeked. Everything that rests on that is a parsing rule, and these are those
 * rules — pure, so they can be pinned without a hook harness or a query engine.
 *
 *   /a/boards/PL       a board
 *   /a/boards/PL-12    that board, card 12 peeked
 *   /a/boards/PL/12    card 12, full page
 *
 * server/urls_test.go pins the Go twin.
 */
describe('parseBoardSegment', () => {
    it('reads a bare slug as a board', () => {
        expect(parseBoardSegment('PL')).toEqual({ slug: 'PL' })
    })

    it('reads the old key spelling as its board', () => {
        expect(parseBoardSegment('PL-12')).toEqual({ slug: 'PL' })
    })

    // A URL is typed from memory as often as it is pasted.
    it('uppercases, so a retyped URL reaches the same board', () => {
        expect(parseBoardSegment('pl')).toEqual({ slug: 'PL' })
        expect(parseBoardSegment('pl-3')).toEqual({ slug: 'PL' })
    })

    // The sibling route must never read as a card — a key needs digits after
    // the hyphen — so it is safe by the parsing rule rather than by name.
    it('does not read my-cards as a key', () => {
        expect(parseBoardSegment('my-cards').slug).toBe('MY-CARDS')
    })

    it('does not read a record id as a key', () => {
        expect(parseBoardSegment('r8f3k2m9x1p7q4w').slug).toBe('R8F3K2M9X1P7Q4W')
    })
})

describe('parseCardNumber', () => {
    it('reads a plain number', () => {
        expect(parseCardNumber('12')).toBe(12)
    })

    // `012` is a typo, and accepting it would give a card two URLs.
    it('rejects leading zeros, blanks and non-numbers', () => {
        expect(parseCardNumber('012')).toBe(0)
        expect(parseCardNumber('')).toBe(0)
        expect(parseCardNumber('abc')).toBe(0)
        expect(parseCardNumber('-1')).toBe(0)
    })
})

describe('paths', () => {
    it('spells a board by slug, or by id when it has none', () => {
        expect(boardSegment({ id: 'p1', slug: 'PL' })).toBe('PL')
        expect(boardSegment({ id: 'p1', slug: '' })).toBe('p1')
        expect(boardPath('PL')).toBe('boards/PL')
        expect(cardPagePath('PL', { id: 'c12', number: 12 })).toBe('boards/PL/12')
    })

    // A card still saving has no number yet; its page is addressed by its id,
    // so opening it does not depend on how fast the server answers.
    it('links a card to its page by number, or by id before it is numbered', () => {
        const orgHref = (path: string, extra?: Record<string, string>): Href => appHref(path, extra)
        const board = { id: 'p1', slug: 'PL' }
        expect(cardHref(orgHref, board, { id: 'c12', number: 12 })).toEqual(appHref('boards/PL/12'))
        expect(cardHref(orgHref, board, { id: 'c0', number: 0 })).toEqual(appHref('boards/PL/c0'))
    })

    it('peeks by key, else by record id', () => {
        const org = (path: string): Href => `/a/${path}` as Href
        expect(peekHref(org, 'PL', { key: 'PL-12', id: 'x' })).toBe('/a/boards/PL/PL-12')
        expect(peekHref(org, 'PL', { key: '', id: 'abcdefghijklmno' })).toBe(
            '/a/boards/PL/abcdefghijklmno'
        )
        expect(peekSegment({ key: '', id: 'abcdefghijklmno' })).toBe('abcdefghijklmno')
        expect(boardHref(org, 'PL')).toBe('/a/boards/PL')
    })

    it('pages by number, else by id', () => {
        const org = (path: string): Href => `/a/${path}` as Href
        expect(cardHref(org, { id: 'b', slug: 'pl' }, { id: 'x', number: 12 })).toBe(
            '/a/boards/pl/12'
        )
        expect(cardHref(org, { id: 'b', slug: '' }, { id: 'abcdefghijklmno', number: 0 })).toBe(
            '/a/boards/b/abcdefghijklmno'
        )
    })
})

describe('parseCardSegment', () => {
    it('reads a key', () =>
        expect(parseCardSegment('pl-12')).toEqual({ kind: 'key', slug: 'PL', number: 12 }))
    it('reads a number', () =>
        expect(parseCardSegment('12')).toEqual({ kind: 'number', number: 12 }))
    it('reads a record id', () =>
        expect(parseCardSegment('abcdefghijklmno')).toEqual({ kind: 'id', id: 'abcdefghijklmno' }))
    it('rejects leading zeros, blanks and junk', () => {
        for (const s of ['012', '', 'PL-012', 'my-cards', 'abc']) {
            expect(parseCardSegment(s)).toEqual({ kind: 'none' })
        }
    })
})

describe('activeBoardIdFromPath', () => {
    const boards = [
        { id: 'p1', slug: 'PL' },
        { id: 'p2', slug: '' },
    ]

    it('names the board from the bare, peeked and full-page shapes', () => {
        expect(activeBoardIdFromPath('/a/boards/PL', boards)).toBe('p1')
        expect(activeBoardIdFromPath('/a/boards/pl-3', boards)).toBe('p1')
        expect(activeBoardIdFromPath('/a/boards/PL/3', boards)).toBe('p1')
        expect(activeBoardIdFromPath('/a/boards/p2', boards)).toBe('p2')
    })

    it('names nothing on My cards, the package root, or another package', () => {
        expect(activeBoardIdFromPath('/a/boards/my-cards', boards)).toBeNull()
        expect(activeBoardIdFromPath('/a/boards', boards)).toBeNull()
        expect(activeBoardIdFromPath('/a/mail/PL', boards)).toBeNull()
    })
})

// A board parks only when the reader went on to ANOTHER board from it: Back
// returns to it, and until then it need hold nothing. Anything else above it
// (My cards, the bare /a/boards) or leaving Boards altogether keeps it live.
describe('isCoveredByBoard', () => {
    const board = (key: string) => ({ key, name: '[boardSlug]' })

    it('is covered by a later board', () => {
        expect(isCoveredByBoard([board('pl'), board('ot')], 'pl')).toBe(true)
    })

    it('is covered by a later board past My cards', () => {
        const routes = [board('pl'), { key: 'mine', name: 'my-cards' }, board('ot')]
        expect(isCoveredByBoard(routes, 'pl')).toBe(true)
    })

    it('is not covered on top, nor under only My cards or the index', () => {
        const routes = [board('pl'), { key: 'mine', name: 'my-cards' }, { key: 'i', name: 'index' }]
        expect(isCoveredByBoard(routes, 'pl')).toBe(false)
        expect(isCoveredByBoard([board('pl'), board('ot')], 'ot')).toBe(false)
    })

    it('is not covered when the route is not in the stack', () => {
        expect(isCoveredByBoard([board('ot')], 'pl')).toBe(false)
    })
})
