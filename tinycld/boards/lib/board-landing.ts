/**
 * Landing on a board from outside its own child stack: a link to a card on
 * another board, or the bare `/a/boards` (and its `?focused=`) on its way to
 * a board.
 *
 * The board screen is singular — one entry in the boards stack, reused for
 * every board — and a push or a pop-to of the reused entry keeps the CHILD
 * stack it had: the cards opened on the board left would sit under the new
 * board's card, naming nothing there (a not-found under the peek, and what
 * native Back pops to). A replace makes a fresh entry but leaves a board
 * beneath the bare `/a/boards` in place: a second board layout with its own
 * queries and its own room.
 *
 * So the boards stack is rewritten instead: every board entry and every bare
 * `/a/boards` entry up to the one on screen is dropped, and one fresh board is
 * laid on what remains. Anything else in the stack (My cards) keeps its place.
 *
 * The fresh board names its child the way React Navigation's nested
 * navigation does — `screen` and `params` — and as a cold load of the URL
 * would build it. Not as a nested `state`: that is a partial state the
 * container reports before the child stack mounts, and the URL was written
 * from it once without the card.
 */

/** The route names of the boards stack and of a board's child stack. */
const BOARD = '[boardSlug]'
const BOARDS_INDEX = 'index'
const BOARD_INDEX = 'index'
const CARD = '[card]'

export interface LandedBoard {
    key: string
    name: string
    params: {
        boardSlug: string
        screen: string
        params: { boardSlug: string; card?: string }
    }
}

/**
 * The boards stack after landing on board `segment`, with the `[card]` segment
 * `card` open over it ('' for the bare board). `index` is the entry on screen;
 * `key` the fresh board entry's, new so the board left's screen unmounts.
 */
export function boardLanding<R extends { name: string }>(
    routes: readonly R[],
    index: number,
    target: { segment: string; card: string; key: string }
): { routes: (R | LandedBoard)[]; index: number } {
    const { segment, card, key } = target
    const kept = routes
        .slice(0, index + 1)
        .filter(route => route.name !== BOARD && route.name !== BOARDS_INDEX)
    const board: LandedBoard = {
        key,
        name: BOARD,
        params: card
            ? { boardSlug: segment, screen: CARD, params: { boardSlug: segment, card } }
            : { boardSlug: segment, screen: BOARD_INDEX, params: { boardSlug: segment } },
    }
    return { routes: [...kept, board], index: kept.length }
}
