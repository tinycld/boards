import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'

/**
 * Is the route this component belongs to the one on screen?
 *
 * `useFocusEffect` fires on route focus and its cleanup runs on blur, which is
 * exactly the window a board's card surface may own the top layer. A plain
 * mount check cannot see this: expo-router leaves a covered screen mounted (on
 * web `freezeOnBlur` only sets `display: none`), so the board and whatever it
 * has open stay alive underneath the full-page card route.
 *
 * Both card surfaces need it, for the same reason and with opposite symptoms.
 * The PEEK uses it for layer membership: a mount-keyed layer stayed on top
 * while invisible, and the first click on the full page read as "outside the
 * peek" and dismissed it, taking its collaborative editor with it. The MODAL
 * uses it to unmount outright — a Dialog renders through OverlayPortal at the
 * top of the stacking order, so a covered board's modal paints straight over
 * the full-page route that was pushed on top of it.
 */
export function useIsRouteFocused(): boolean {
    const [isFocused, setIsFocused] = useState(false)
    useFocusEffect(
        useCallback(() => {
            setIsFocused(true)
            return () => setIsFocused(false)
        }, [])
    )
    return isFocused
}
