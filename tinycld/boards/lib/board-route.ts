import type { Href } from 'expo-router'
import type { BoardProject } from '../types'
import { flattenCards } from './board-cards'
import { parseCardKey } from './card-key'

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
 *   boards/PL-12            that board, card 12 peeked
 *   boards/PL?focused=<id>  the peek for a card with no key yet, and every
 *                           link core mints (`?focused=` is an ecosystem
 *                           convention, so it is accepted and never dropped)
 *   boards/PL/12            card 12, full page
 *   boards/my-cards         unchanged — it does not parse as a key
 *
 * ONE segment, told apart by `parseCardKey`: a key has a hyphen followed by
 * digits, a slug has neither, and a 15-character PocketBase id has no hyphen
 * at all. So `my-cards` and a record id both fall through to "board" without
 * a special case. Which record id names a card rather than a board is the one
 * question a parser cannot answer — useBoardRoute asks the local collections.
 */

export interface BoardSegment {
    /** Uppercased: slugs are stored uppercase and a URL is retyped from memory. */
    slug: string
    /** 0 when the segment names only a board. */
    cardNumber: number
}

export function parseBoardSegment(segment: string): BoardSegment {
    const key = parseCardKey(segment)
    if (key) return { slug: key.slug, cardNumber: key.number }
    return { slug: segment.trim().toUpperCase(), cardNumber: 0 }
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

/** Could this segment be a PocketBase record id? (Slugs stop at ten characters.) */
export function isRecordId(segment: string): boolean {
    return /^[a-z0-9]{15}$/.test(segment)
}

/** A board's canonical URL segment: its slug, or its id when it has none. */
export function boardSegment(board: { id: string; slug: string }): string {
    return board.slug || board.id
}

export function boardPath(segment: string): string {
    return `boards/${segment}`
}

export function cardPagePath(segment: string, cardNumber: number): string {
    return `boards/${segment}/${cardNumber}`
}

/**
 * The route params that put `card` in the peek on the board at `segment`, or
 * take it out when `card` is null.
 *
 * The key rides in the path (`boards/PL-12`); a card with no key — a board
 * without a slug, or a card the server has not numbered yet — falls back to
 * `?focused=<id>`, which is also the spelling core's notifications use. Both
 * keys are always present so a `setParams` call clears whichever one the URL
 * carried before.
 */
export function peekParams(
    segment: string,
    card: { key: string; id: string } | null
): { boardSlug: string; focused: string | undefined } {
    if (!card) return { boardSlug: segment, focused: undefined }
    if (card.key) return { boardSlug: card.key, focused: undefined }
    return { boardSlug: segment, focused: card.id }
}

type HrefBuilder = (path: string, extra?: Record<string, string>) => Href

/** A link to `card` peeked on its board — what search and cross-board links navigate to. */
export function peekHref(
    orgHref: HrefBuilder,
    segment: string,
    card: { key: string; id: string }
): Href {
    const params = peekParams(segment, card)
    return params.focused
        ? orgHref(boardPath(params.boardSlug), { focused: params.focused })
        : orgHref(boardPath(params.boardSlug))
}

/**
 * The card a board URL names, as the URL spells it: a key in the segment, else
 * the `?focused=` value, else ''. A key in the path wins because only one
 * spelling is ever written, and the path is the newer one.
 */
export function urlCardParam(boardSlug: string, focused: string): string {
    if (parseCardKey(boardSlug)) return boardSlug
    return focused
}

/**
 * A URL's card param -> a card id on THIS board, or ''.
 *
 * Accepts a key or a raw record id. A key is checked against the board's own
 * slug so `OTTER-2` on the FOX board resolves to nothing rather than to
 * whichever card happens to be numbered 2 here.
 */
export function resolveCardOnBoard(project: BoardProject, param: string): string {
    if (!param) return ''
    const key = parseCardKey(param)
    const wanted = key ? `${key.slug}-${key.number}` : ''
    if (key && (!project.slug || key.slug !== project.slug.toUpperCase())) return ''
    for (const { card } of flattenCards(project)) {
        if (key ? card.key === wanted : card.id === param) return card.id
    }
    return ''
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
