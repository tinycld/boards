import { usePathname } from 'expo-router'
import { cardSegmentOfPath } from '../lib/board-route'

/**
 * The `[card]` segment on top of the board's child stack, '' when the index
 * child is on top.
 *
 * Read from the focused route's path, which follows it wherever it sits in the
 * navigator tree, rather than mirrored into component state from a focus
 * listener: a mirror is a render behind the route and goes stale whenever an
 * event is missed. Walking `useRootNavigationState` to the layout's child
 * stack looked equivalent but left the layout un-rendered after a card opened
 * on a board reached from the sidebar, so presence never learned the card.
 *
 * The path, not the global params: after a card reached by URL — the rail
 * returning to Boards restores the board's last href — is closed, the path is
 * the bare board's but the global params still carry the closed card's
 * `card`. Read from them, the board took that card for open, and a press on
 * it did nothing.
 *
 * Only meaningful while the board is the focused screen; a blurred board is
 * parked (screens/[boardSlug]/_layout.tsx) and resolves no card from it.
 */
export function useTopCardSegment(): string {
    return cardSegmentOfPath(usePathname())
}
