import { and, eq } from '@tanstack/db'
import { useAuth } from '@tinycld/core/lib/auth'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { capabilitiesFor, type ProjectCapabilities } from '../lib/permissions'
import type { CardsMemberRole } from '../types'

export interface ProjectRole extends ProjectCapabilities {
    role: CardsMemberRole | null
    isReady: boolean
}

/**
 * The caller's role on one project, live, plus the capabilities derived from
 * it in lib/permissions.ts (the only role interpreter — see its header).
 *
 * Queries the caller's OWN cards_project_members row, never the roster: the
 * `user = @request.auth.id` disjunct on the member rules guarantees that row is
 * readable even by an org-level guest, whom the roster rule excludes.
 *
 * `role` is null BOTH while the query loads AND when the caller genuinely
 * holds no membership, so every capability defaults to deny in flight —
 * affordances pop in rather than 403. Gate refusal chrome (read-only notices,
 * the guest roster note) on `isReady`, or a legitimate owner sees it flash on
 * a cold load. A freshly-created board never flashes at its creator:
 * useCreateProject inserts the owner row optimistically, so it is already in
 * the local store by the first render.
 *
 * Call it per-surface rather than prop-drilling from a screen root — every
 * call with the same projectId shares one live query.
 */
export function useProjectRole(projectId: string): ProjectRole {
    const [membersCollection] = useStore('cards_project_members')
    // `throwIfAnon: false` is load-bearing, not defensive. The default throws
    // AuthRequiredError, which is right for every workspace surface — they are
    // behind the auth gate and a missing session there is a bug. This hook also
    // runs on the PUBLIC board, where being anonymous is the normal case, and
    // the default turned that screen into an error boundary.
    const { user } = useAuth({ throwIfAnon: false })

    const { data: rows, isReady } = useOrgLiveQuery(
        (query, { userId }) => {
            if (!projectId) return null
            return query
                .from({ member: membersCollection })
                .where(({ member }) => and(eq(member.project, projectId), eq(member.user, userId)))
        },
        [projectId]
    )

    const role = rows?.[0]?.role ?? null

    // A share-link visitor is unauthenticated, so useOrgLiveQuery disables
    // itself and `isReady` never settles. Left alone that would be a board with
    // every capability correctly denied but its read-only notice permanently
    // suppressed — the query is not "still loading", it is never going to run.
    // Settling it here makes the refusal chrome render, which is the honest
    // state: no membership, and none coming.
    const ready = user ? isReady : true

    return { role, isReady: ready, ...capabilitiesFor(role) }
}
