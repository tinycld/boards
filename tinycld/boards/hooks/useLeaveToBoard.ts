import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useRouter } from 'expo-router'
import { useCallback } from 'react'
import { boardHref } from '../lib/board-route'
import { useBoardLayout } from './useBoardLayout'

/**
 * Leave every card on this board in one step, for the board with nothing open.
 *
 * j/k and the sub-task and link rows each push a card, so `router.back()`
 * would step back ONE card, while Escape, ✕ and "Back to board" all say
 * "the board". `dismissTo` pops the board's stack to its index child, or
 * replaces the card with it when none is below (a link followed straight to a
 * card). The browser's Back still walks the cards.
 */
export function useLeaveToBoard(): () => void {
    const router = useRouter()
    const orgHref = useOrgHref()
    const { segment } = useBoardLayout()
    return useCallback(
        () => router.dismissTo(boardHref(orgHref, segment)),
        [router, orgHref, segment]
    )
}
