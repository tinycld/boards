import { useCallback, useEffect, useRef, useState } from 'react'

const COPIED_RESET_MS = 2000

/**
 * A "copied!" flag that flips back on its own after a moment.
 *
 * The timer is held in a ref and cleared on unmount: a bare
 * `setTimeout(() => setCopied(false), 2000)` keeps a handle on a component that
 * may already be gone — closing the card peek within two seconds of copying
 * leaves a pending setState on an unmounted tree, and the timer itself outlives
 * the component either way.
 *
 * Copying again restarts the countdown rather than stacking timers, so the
 * label reflects the most recent copy.
 */
export function useCopiedFlag(): [boolean, () => void] {
    const [copied, setCopied] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current)
        },
        []
    )

    const markCopied = useCallback(() => {
        if (timer.current) clearTimeout(timer.current)
        setCopied(true)
        timer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS)
    }, [])

    return [copied, markCopied]
}
