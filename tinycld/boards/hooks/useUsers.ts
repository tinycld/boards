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
 * people" picker. The roster stays org-wide rather than scoped to the
 * board's own membership because that picker needs to offer people NOT yet
 * on the board — a membership-scoped read would make it unable to invite
 * anyone new. One definition rather than one per caller: TanStack DB already
 * folds identical queries into one live collection, so this costs nothing
 * extra per consumer either way.
 *
 * The `.select()` below does NOT shrink what crosses the wire — pbtsdb never
 * sends PocketBase a `fields=` restriction (it always fetches the full row),
 * and PocketBase never returns password hashes regardless. What it narrows
 * is the RESULT SHAPE every consumer is typed against: seven named fields
 * instead of the full generated `Users` record, so a caller can't reach for
 * a field this hook was never meant to expose and so board-project.ts's
 * `UserLike`/`toBoardMember` stay the single place that shape is declared.
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
