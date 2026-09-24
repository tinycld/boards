import { useStore } from '@tinycld/core/lib/pocketbase'
import { useMemo } from 'react'
import { toBoardMember } from '../lib/board-project'
import type { BoardMember } from '../types'
import { useBoardLiveQuery } from './useBoardLiveQuery'

/**
 * Every user this client has synced.
 *
 * The one unfiltered read of the eager `users` store, shared by the board
 * tree (assignees may name someone no longer on the roster), the reaction
 * tooltips and the member picker. One definition rather than one per caller:
 * TanStack DB already folds identical queries into one live collection, so
 * this saves nothing on the wire — it keeps the read in one place so a
 * scoping decision is made once.
 *
 * Empty for a share-link visitor: core's rule admits only a non-guest member
 * or your own row, and every consumer already renders a placeholder for an
 * id it cannot resolve.
 */
export function useUserRows() {
    const [usersCollection] = useStore('users')
    const { data } = useBoardLiveQuery(query => query.from({ user: usersCollection }))
    return data
}

/** The synced users as board members, by id — the assignee/reactor shape. */
export function useMembersById(): Map<string, BoardMember> {
    const users = useUserRows()
    return useMemo(
        () => new Map((users ?? []).map(user => [user.id, toBoardMember(user)])),
        [users]
    )
}
