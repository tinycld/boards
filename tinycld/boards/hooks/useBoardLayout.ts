import { createContext, useContext } from 'react'
import type { BoardProject } from '../types'

/**
 * The board the layout route resolved, handed to its child routes.
 *
 * The board's queries, room and chrome are mounted ONCE, in
 * `screens/[boardSlug]/_layout.tsx`; the card children (peek, modal, page)
 * stack beneath it and read the board from here rather than querying it
 * again. A context rather than a store: the value belongs to one mounted
 * board and goes away with it.
 *
 * Its own module so a hook can read it without importing the layout screen,
 * which imports those hooks back.
 */
export interface BoardLayoutValue {
    /** The board as the reader views it: filtered, sorted, scoped. */
    project: BoardProject
    /**
     * Every live card, before the reader's view. Cards are resolved here, so a
     * link to a card the filter hides still opens it and an edit that takes
     * the open card out of the filter does not close it.
     */
    fullProject: BoardProject
    /** The board's canonical URL segment: its slug, or its id when it has none. */
    segment: string
    isArchived: boolean
    cardCount: number
}

const BoardLayoutContext = createContext<BoardLayoutValue | null>(null)

export const BoardLayoutProvider = BoardLayoutContext.Provider

export function useBoardLayout(): BoardLayoutValue {
    const value = useContext(BoardLayoutContext)
    if (!value) throw new Error('useBoardLayout is only available under the board layout route')
    return value
}
