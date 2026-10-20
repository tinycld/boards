import { useUrl } from '@tinycld/core/lib/use-url'

/**
 * The `[card]` segment on top of the board's child stack, '' when the index
 * child is on top.
 *
 * Read from the current URL, which follows the focused route wherever it sits
 * in the navigator tree, rather than mirrored into component state from a
 * focus listener: a mirror is a render behind the route and goes stale
 * whenever an event is missed.
 *
 * Only meaningful while the board is the focused screen; a blurred board is
 * parked (screens/[boardSlug]/_layout.tsx) and resolves no card from it.
 */
export function useTopCardSegment(): string {
    return cardParam(useUrl().params)
}

/** The `[card]` param a child route carries, '' for the index child. */
export function cardParam(params: object | undefined): string {
    if (!params || !('card' in params)) return ''
    const card = params.card
    return typeof card === 'string' ? card : ''
}
