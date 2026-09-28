import { useStore } from '@tinycld/core/lib/pocketbase'
import { useMemo } from 'react'
import { toBoardMember } from '../lib/board-project'
import type { BoardMember } from '../types'
import { useBoardLiveQuery } from './useBoardLiveQuery'

/**
 * Every user this client has synced, narrowed to what `toBoardMember` reads.
 *
 * The one unfiltered read of the `users` store — so every user is in the
 * store while a board is open — shared by the board tree (assignees may name
 * someone no longer on the roster), the reaction tooltips and the "Add
 * people" picker (which needs the whole org roster precisely BECAUSE it is
 * offering people not yet on the board — scoping this read to the board's
 * own membership would make that picker unable to invite anyone new, so the
 * predicate stays unfiltered). One definition rather than one per caller:
 * TanStack DB already folds identical queries into one live collection, so
 * narrowing the predicate would save nothing on the wire — the `.select()`
 * below is the lever, shrinking every row to the seven fields any consumer
 * actually uses instead of the full record (password hash fields included).
 *
 * Empty for a share-link visitor: core's rule admits only a non-guest member
 * or your own row, and every consumer already renders a placeholder for an
 * id it cannot resolve.
 */
export function useUserRows() {
    const [usersCollection] = useStore('users')
    const { data } = useBoardLiveQuery(query =>
        query.from({ user: usersCollection }).select(({ user }) => ({
            id: user.id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            avatar_crop: user.avatar_crop,
            avatar_color: user.avatar_color,
            avatar_emoji: user.avatar_emoji,
        }))
    )
    return data
}

export type BoardUserRow = NonNullable<ReturnType<typeof useUserRows>>[number]

/** The synced users as board members, by id — the assignee/reactor shape. */
export function useMembersById(): Map<string, BoardMember> {
    const users = useUserRows()
    return useMemo(
        () => new Map((users ?? []).map(user => [user.id, toBoardMember(user)])),
        [users]
    )
}
