import { useRootNavigationState, useRoute } from 'expo-router'

interface NavState {
    index?: number
    routes: { key: string; params?: object; state?: NavState }[]
}

/**
 * The `[card]` segment on top of the board's child stack, '' when the index
 * child is on top.
 *
 * Read from the navigation state, which the router keeps current, rather than
 * mirrored into component state from a focus listener: a mirror is a render
 * behind the route and goes stale whenever an event is missed. The board layout
 * is a route of the root navigator, so its own child stack is nested under it.
 */
export function useTopCardSegment(): string {
    const { key } = useRoute()
    const root = useRootNavigationState()
    return topCardSegment(root, key)
}

export function topCardSegment(state: object | undefined, layoutKey: string): string {
    const stack = childStateOf(state as NavState | undefined, layoutKey)
    if (!stack) return ''
    const top = stack.routes[stack.index ?? stack.routes.length - 1]
    return cardParam(top?.params)
}

function childStateOf(state: NavState | undefined, layoutKey: string): NavState | undefined {
    for (const route of state?.routes ?? []) {
        if (route.key === layoutKey) return route.state
        const found = childStateOf(route.state, layoutKey)
        if (found) return found
    }
    return undefined
}

/** The `[card]` param a child route carries, '' for the index child. */
export function cardParam(params: object | undefined): string {
    if (!params || !('card' in params)) return ''
    const card = params.card
    return typeof card === 'string' ? card : ''
}
