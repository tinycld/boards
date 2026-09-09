import { useStore } from '@tinycld/core/lib/pocketbase'
import { useMemo } from 'react'
import { toBoardMember } from '../lib/board-project'
import { reactorNameLookup } from '../lib/reactions'
import { useBoardLiveQuery } from './useBoardLiveQuery'

/**
 * Resolves a reactor's id to a display name for the chip tooltip.
 *
 * Reads the eagerly-synced `users` store, so this costs no round trip — the
 * rows are already local, which is why the reactions row carries a plain
 * relation and no expand.
 *
 * An id with no readable row falls back to "Board member": a share-link
 * visitor can read reactions but not the users behind them, and that is the
 * same placeholder assignees already use.
 */
export function useReactorNames(): (userId: string) => string {
    const [usersCollection] = useStore('users')

    const { data: users } = useBoardLiveQuery(query => query.from({ user: usersCollection }))

    return useMemo(() => {
        // toBoardMember owns how a display name is derived from `name` or,
        // failing that, the email local-part — reusing it keeps the tooltip
        // naming people exactly as the assignee stack does.
        const byId = new Map((users ?? []).map(user => [user.id, toBoardMember(user)]))
        return reactorNameLookup(byId)
    }, [users])
}
