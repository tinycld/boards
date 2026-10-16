import type { Href } from 'expo-router'
import { isRecordId, parseCardKey } from './card-key'

/**
 * The URL shapes under `/a/boards`, and the rules that read them.
 *
 * Pure and free of React so every rule can be pinned in tests/board-route.test.ts
 * without a hook harness or a query engine. server/urls.go is the Go twin for
 * the URLs notifications mint; keep the two in step by hand.
 *
 *   boards                  the package root -> the reader's last board
 *   boards/PL               a board, by slug (or by record id, for a board
 *                           created without one)
 *   boards/PL/PL-12         that board, card 12 peeked (or in the modal)
 *   boards/PL/<id>          the same peek for a card with no key yet; the
 *                           screen respells it as the key once that lands
 *   boards/PL/12            card 12, full page, covering the board
 *   boards/PL-12            old spelling; redirects to boards/PL/PL-12
 *   boards/my-cards         unchanged — it does not parse as a key
 *
 * The board segment is told apart by `parseCardKey` (the old `PL-12` spelling
 * still reaches the board screen); the child segment by `parseCardSegment`.
 * `my-cards` and a record id both fall through to "board" without a special
 * case.
 */

export interface BoardSegment {
    /** Uppercased: slugs are stored uppercase and a URL is retyped from memory. */
    slug: string
}

/** The board a board segment names; the old `PL-12` spelling names board PL. */
export function parseBoardSegment(segment: string): BoardSegment {
    const key = parseCardKey(segment)
    if (key) return { slug: key.slug }
    return { slug: segment.trim().toUpperCase() }
}

/**
 * The card number carried alone by `boards/PL/12`, or 0.
 *
 * Rejects leading zeros for the reason `parseCardKey` does: `012` is a typo,
 * and accepting it would give a card two URLs with neither canonical.
 */
export function parseCardNumber(segment: string): number {
    const trimmed = segment.trim()
    if (!/^[1-9]\d*$/.test(trimmed)) return 0
    const number = Number(trimmed)
    return Number.isSafeInteger(number) ? number : 0
}

/** A board's canonical URL segment: its slug, or its id when it has none. */
export function boardSegment(board: { id: string; slug: string }): string {
    return board.slug || board.id
}

export function boardPath(segment: string): string {
    return `boards/${segment}`
}

/**
 * The path of `card`'s full page: `boards/PL/12`, or `boards/PL/<id>` while
 * the server has not numbered it, so a card still saving has a page too.
 */
export function cardPagePath(segment: string, card: { id: string; number: number }): string {
    return `boards/${segment}/${card.number || card.id}`
}

type HrefBuilder = (path: string, extra?: Record<string, string>) => Href

/** A link to `card`'s full page (see cardPagePath). */
export function cardHref(
    orgHref: HrefBuilder,
    board: { id: string; slug: string },
    card: { id: string; number: number }
): Href {
    return orgHref(cardPagePath(boardSegment(board), card))
}

/** The [card] segment that peeks `card` on its board: the key, else the record id. */
export function peekSegment(card: { key: string; id: string }): string {
    return card.key || card.id
}

/** A link to `card` peeked over its board — what search and cross-board links navigate to. */
export function peekHref(
    orgHref: HrefBuilder,
    segment: string,
    card: { key: string; id: string }
): Href {
    return orgHref(`${boardPath(segment)}/${peekSegment(card)}`)
}

/** A link to a board with no card open. */
export function boardHref(orgHref: HrefBuilder, segment: string): Href {
    return orgHref(boardPath(segment))
}

export type CardSegment =
    | { kind: 'none' }
    | { kind: 'key'; slug: string; number: number }
    | { kind: 'id'; id: string }
    | { kind: 'number'; number: number }

/**
 * What a `[card]` segment names. Key first, then number, then record id: a key
 * has a hyphen, a number is digits only, an id is 15 lowercase alphanumerics.
 */
export function parseCardSegment(segment: string): CardSegment {
    const key = parseCardKey(segment)
    if (key) return { kind: 'key', slug: key.slug, number: key.number }
    const number = parseCardNumber(segment)
    if (number) return { kind: 'number', number }
    const trimmed = segment.trim()
    if (isRecordId(trimmed)) return { kind: 'id', id: trimmed }
    return { kind: 'none' }
}

/**
 * Which board a pathname is showing, for the sidebar highlight.
 *
 * Read from the URL rather than the store so the highlight cannot lag or
 * disagree with the screen: a card's full page, the peek and the bare board
 * all name their board in segment three.
 */
export function activeBoardIdFromPath(
    pathname: string,
    boards: readonly { id: string; slug: string }[]
): string | null {
    const [, , pkg, segment = ''] = pathname.split('/')
    if (pkg !== 'boards' || !segment) return null
    const { slug } = parseBoardSegment(decodeURIComponent(segment))
    const board = boards.find(b => b.id === segment || (b.slug && b.slug.toUpperCase() === slug))
    return board?.id ?? null
}

/** A route param as one string: expo-router types repeated params as arrays. */
export function paramString(value: string | string[] | undefined): string {
    if (Array.isArray(value)) return value[0] ?? ''
    return value ?? ''
}

/**
 * Whether a later board sits above the route `key` in the boards stack: the
 * reader went on from this board to another, and Back will return here. Only
 * a board covers one — My cards or the bare `/a/boards` above it, or leaving
 * Boards altogether, does not.
 */
export function isCoveredByBoard(
    routes: readonly { key: string; name: string }[],
    key: string
): boolean {
    const index = routes.findIndex(route => route.key === key)
    if (index < 0) return false
    return routes.slice(index + 1).some(route => route.name === '[boardSlug]')
}

/**
 * Whether `pathname` names a card on its board: a peek (`/a/boards/PL/PL-12`)
 * or a page (`/a/boards/PL/12`), rather than the bare board.
 */
export function pathNamesCard(pathname: string): boolean {
    return cardSegmentOfPath(pathname) !== ''
}

/** The `[card]` segment `pathname` names on its board, '' for none. */
export function cardSegmentOfPath(pathname: string): string {
    const [, , pkg, board = '', card = ''] = pathname.split('/')
    return pkg === 'boards' && board !== '' ? card : ''
}

/** The `[card]` param a child route carries, '' for the index child. */
export function cardParam(params: object | undefined): string {
    if (!params || !('card' in params)) return ''
    const card = params.card
    return typeof card === 'string' ? card : ''
}
