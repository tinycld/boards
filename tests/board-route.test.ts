import { appHref } from '@tinycld/core/lib/org-routes'
import type { Href } from 'expo-router'
import { describe, expect, it } from 'vitest'
import {
    activeBoardIdFromPath,
    boardPath,
    boardSegment,
    cardHref,
    cardPagePath,
    parseBoardSegment,
    parseCardNumber,
    peekHref,
    peekParams,
    resolveCardOnBoard,
    urlCardParam,
} from '../tinycld/boards/lib/board-route'
import type { BoardProject } from '../tinycld/boards/types'

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
        expect(parseBoardSegment('PL')).toEqual({ slug: 'PL', cardNumber: 0 })
    })

    it('reads a key as a board AND a card', () => {
        expect(parseBoardSegment('PL-12')).toEqual({ slug: 'PL', cardNumber: 12 })
    })

    // A URL is typed from memory as often as it is pasted.
    it('uppercases, so a retyped URL reaches the same board', () => {
        expect(parseBoardSegment('pl')).toEqual({ slug: 'PL', cardNumber: 0 })
        expect(parseBoardSegment('pl-3')).toEqual({ slug: 'PL', cardNumber: 3 })
    })

    // The sibling route must never read as a card — a key needs digits after
    // the hyphen — so it is safe by the parsing rule rather than by name.
    it('does not read my-cards as a key', () => {
        expect(parseBoardSegment('my-cards').cardNumber).toBe(0)
    })

    it('does not read a record id as a key', () => {
        expect(parseBoardSegment('r8f3k2m9x1p7q4w').cardNumber).toBe(0)
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
        expect(cardPagePath('PL', 12)).toBe('boards/PL/12')
    })

    // A card the server has not numbered has no page yet, so it links peeked.
    it('links a card to its page, or peeked on its board before it is numbered', () => {
        const orgHref = (path: string, extra?: Record<string, string>): Href =>
            appHref(path, extra)
        const board = { id: 'p1', slug: 'PL' }
        expect(cardHref(orgHref, board, { id: 'c12', number: 12 })).toEqual(
            appHref('boards/PL/12')
        )
        expect(cardHref(orgHref, board, { id: 'c0', number: 0 })).toEqual(
            appHref('boards/PL', { focused: 'c0' })
        )
    })

    it('puts a keyed card in the path and a keyless one in ?focused=', () => {
        expect(peekParams('PL', { key: 'PL-12', id: 'c1' })).toEqual({
            boardSlug: 'PL-12',
            focused: undefined,
        })
        expect(peekParams('p1', { key: '', id: 'c1' })).toEqual({ boardSlug: 'p1', focused: 'c1' })
        // Closing names both params so setParams clears whichever was set.
        expect(peekParams('PL', null)).toEqual({ boardSlug: 'PL', focused: undefined })
    })

    it('builds the matching href', () => {
        const orgHref = (path: string, extra?: Record<string, string>): Href =>
            (extra ? { pathname: appHref(path), params: extra } : appHref(path)) as Href
        expect(peekHref(orgHref, 'PL', { key: 'PL-12', id: 'c1' })).toBe('/a/boards/PL-12')
        expect(peekHref(orgHref, 'p1', { key: '', id: 'c1' })).toEqual({
            pathname: '/a/boards/p1',
            params: { focused: 'c1' },
        })
    })
})

describe('urlCardParam', () => {
    it('prefers a key in the segment over ?focused=', () => {
        expect(urlCardParam('PL-3', 'PL-9')).toBe('PL-3')
        expect(urlCardParam('PL', 'PL-9')).toBe('PL-9')
        expect(urlCardParam('PL', '')).toBe('')
    })
})

function board(overrides: Partial<BoardProject> = {}): BoardProject {
    return {
        id: 'p1',
        name: 'Home projects',
        slug: 'HOME',
        color: '#4A86E8',
        members: [],
        labels: [],
        listOrder: [{ id: 'l1', position: 'a0' }],
        lists: [
            {
                id: 'l1',
                name: 'To do',
                position: 'a0',
                category: 'todo',
                cards: [card('c1', 'HOME-1', 1), card('c2', 'HOME-2', 2)],
            },
        ],
        ...overrides,
    } as BoardProject
}

function card(id: string, key: string, number: number) {
    return {
        id,
        key,
        number,
        listId: 'l1',
        position: 'a0',
        title: id,
        description: '',
        labels: [],
        assignees: [],
        checklistTotal: 0,
        checklistDone: 0,
        commentCount: 0,
        attachmentCount: 0,
        listCategory: 'todo',
    }
}

describe('resolveCardOnBoard', () => {
    it('resolves a key, in either case', () => {
        expect(resolveCardOnBoard(board(), 'HOME-2')).toBe('c2')
        expect(resolveCardOnBoard(board(), 'home-2')).toBe('c2')
    })

    // The `?focused=<id>` spelling: core's notifications, and a keyless card.
    it('resolves a raw record id', () => {
        expect(resolveCardOnBoard(board(), 'c1')).toBe('c1')
    })

    // A key from ANOTHER board must not resolve to whichever local card
    // happens to carry that number.
    it('ignores a key belonging to a different board', () => {
        expect(resolveCardOnBoard(board(), 'FOX-2')).toBe('')
    })

    it('ignores a number that names no card here, and an empty param', () => {
        expect(resolveCardOnBoard(board(), 'HOME-99')).toBe('')
        expect(resolveCardOnBoard(board(), '')).toBe('')
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
