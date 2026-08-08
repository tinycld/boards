import { createContext, type ReactNode, useContext, useMemo } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import { type RemoteCardsPresence, useBoardPresence } from '../hooks/useBoardPresence'

interface BoardPresenceValue {
    awareness: Awareness | null
    peers: RemoteCardsPresence[]
}

const BoardPresenceContext = createContext<BoardPresenceValue>({ awareness: null, peers: [] })

/**
 * Holds the board's single presence room, so the header's avatar stack and the
 * per-card clusters read one connection rather than opening one each.
 *
 * A React context rather than a Zustand store, against the usual house rule for
 * shared UI state: what is being shared is a live socket handle scoped to the
 * mounted board, not state. A store would outlive the board it belongs to and
 * would need explicit teardown; the provider unmounts with the screen and
 * `useRealtimeRoom` already publishes a clean-leave frame on the way out.
 */
export function BoardPresenceProvider({
    projectId,
    openCardId,
    children,
}: {
    projectId: string
    openCardId: string | null
    children: ReactNode
}) {
    const { awareness, peers } = useBoardPresence(projectId, openCardId)
    // Memoized so a board re-render for any unrelated reason does not push a
    // new context value at every consumer.
    const value = useMemo(() => ({ awareness, peers }), [awareness, peers])
    return <BoardPresenceContext.Provider value={value}>{children}</BoardPresenceContext.Provider>
}

export function useBoardPresenceContext(): BoardPresenceValue {
    return useContext(BoardPresenceContext)
}

/** Shared empty result, so "nobody here" is one stable reference board-wide. */
const NO_PEERS: RemoteCardsPresence[] = []

/**
 * The peers currently looking at one card.
 *
 * Memoized on the peer list so a card whose watchers did not change keeps the
 * same array — a fresh `.filter()` every render would make every card's props
 * change on every awareness tick and undo the memoization that keeps drags
 * stable. `useRemoteAwareness` already returns the SAME array when nothing
 * changed, so this recomputes only on a real presence change.
 */
export function useCardPresence(cardId: string): RemoteCardsPresence[] {
    const { peers } = useBoardPresenceContext()
    return useMemo(() => {
        if (peers.length === 0) return NO_PEERS
        const here = peers.filter(peer => peer.cardId === cardId)
        return here.length === 0 ? NO_PEERS : here
    }, [peers, cardId])
}
