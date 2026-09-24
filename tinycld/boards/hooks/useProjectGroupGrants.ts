import { useAuth } from '@tinycld/core/lib/auth'
import { useGroupGrants } from '@tinycld/core/lib/groups/use-group-grants'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { GROUP_ROLE_OPTIONS } from '../components/sharing/roles'

/**
 * Group grants on one project, ready to spread into GroupShareSection. Core
 * owns the query and the writes; this wrapper only tells it which collection,
 * which resource, and how a boards row is built.
 */
export function useProjectGroupGrants(projectId: string) {
    const { user } = useAuth({ throwIfAnon: false })
    const [membersCollection] = useStore('boards_project_members')
    return useGroupGrants({
        collection: membersCollection,
        roles: GROUP_ROLE_OPTIONS,
        isForResource: row => row.project === projectId,
        buildRow: grant => ({
            ...grant,
            project: projectId,
            created_by: user?.id ?? '',
        }),
    })
}
