import { eq } from '@tanstack/db'
import { useAuth } from '@tinycld/core/lib/auth'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useMemo } from 'react'
import type { CardsMemberRole } from '../types'

export interface ProjectMemberRow {
    membershipId: string
    userId: string
    name: string
    email: string
    role: CardsMemberRole
    isCurrentUser: boolean
}

/**
 * The Share dialog's roster: membership rows joined to users, with the fields
 * the dialog needs (email, role) that `BoardProject.members` deliberately does
 * not carry — BoardMember doubles as the assignee shape, where a role is
 * meaningless. Owning its own query also keeps the dialog usable from any
 * surface that has a project id (drive's use-share-data precedent).
 *
 * For an org-level guest the roster rule filters this to exactly ONE row —
 * their own. That is the deliberate guest state, not an error; the dialog
 * explains it rather than looking broken.
 */
export function useProjectMembers(projectId: string) {
    // Non-throwing: BoardColumn calls the mutation hooks unconditionally, so
    // they are constructed on the PUBLIC board too — where there is no
    // session and the affordances that would invoke them are already gated
    // off. Throwing here made merely RENDERING a shared board an error.
    const { user } = useAuth({ throwIfAnon: false })
    const [membersCollection, usersCollection] = useStore('cards_project_members', 'users')

    const { data: rows, isReady } = useOrgLiveQuery(
        query => {
            if (!projectId) return null
            return query
                .from({ member: membersCollection })
                .innerJoin({ user: usersCollection }, ({ member, user: u }) =>
                    eq(member.user, u.id)
                )
                .where(({ member }) => eq(member.project, projectId))
        },
        [projectId]
    )

    const members = useMemo<ProjectMemberRow[]>(() => {
        const mapped = (rows ?? []).map(row => ({
            membershipId: row.member.id,
            userId: row.user.id,
            name: row.user.name,
            email: row.user.email,
            role: row.member.role,
            isCurrentUser: row.user.id === user?.id,
        }))
        // Owners first, then alphabetical — the people who can act on this
        // dialog are the ones worth finding fast.
        return mapped.sort((a, b) => {
            const aOwner = a.role === 'owner' ? 0 : 1
            const bOwner = b.role === 'owner' ? 0 : 1
            return aOwner - bOwner || (a.name || a.email).localeCompare(b.name || b.email)
        })
    }, [rows, user?.id])

    const ownerCount = useMemo(
        () => members.filter(member => member.role === 'owner').length,
        [members]
    )

    return { members, ownerCount, isReady }
}
