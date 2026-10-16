import { useGlobalSearchParams } from 'expo-router'

/**
 * The `[card]` segment on top of the board's child stack, '' when the index
 * child is on top.
 *
 * Read from the router's global params, which follow the focused route
 * wherever it sits in the navigator tree, rather than mirrored into component
 * state from a focus listener: a mirror is a render behind the route and goes
 * stale whenever an event is missed. Walking `useRootNavigationState` to the
 * layout's child stack looked equivalent but left the layout un-rendered after
 * a card opened on a board reached from the sidebar, so presence never learned
 * the card.
 *
 * Only meaningful while the board is the focused screen; a blurred board's
 * room has left (useRealtimeRoom's useLeaveOnBlur) and its frozen tree does
 * not render.
 */
export function useTopCardSegment(): string {
    return cardParam(useGlobalSearchParams())
}

/** The `[card]` param a child route carries, '' for the index child. */
export function cardParam(params: object | undefined): string {
    if (!params || !('card' in params)) return ''
    const card = params.card
    return typeof card === 'string' ? card : ''
}
