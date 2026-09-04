import { useAuth } from '@tinycld/core/lib/auth'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'
import type { BoardsMemberRole } from '../types'

/**
 * Membership mutations for the Share dialog. Every one is a plain collection
 * op: unlike drive — whose add-member endpoint mints users for invited contact
 * emails — a cards member is always an existing `users` row, so there is no Go
 * endpoint and nothing to batch.
 *
 * What the rules allow, because the UI must not offer more: add, change-role
 * and remove-other are owner-only (`viaOwner`); removing your OWN row is open
 * to any member (leave a board). The server's last-owner guard can still
 * refuse a demote/remove of the sole owner — callers surface `error.message`
 * in the dialog rather than closing it, so the refusal reads as an answer.
 */

export interface AddMemberInput {
    userId: string
    role: BoardsMemberRole
}

export function useAddMember(
    projectId: string,
    options: { onSuccess?: () => void; onError?: (error: unknown) => void } = {}
) {
    // Non-throwing: BoardColumn calls the mutation hooks unconditionally, so
    // they are constructed on the PUBLIC board too — where there is no
    // session and the affordances that would invoke them are already gated
    // off. Throwing here made merely RENDERING a shared board an error.
    const { user } = useAuth({ throwIfAnon: false })
    const [membersCollection] = useStore('boards_project_members')

    return useMutation<void, Error, AddMemberInput>({
        mutationKey: ['boards', 'member', 'add'],
        mutationFn: mutation(function* (input: AddMemberInput) {
            yield membersCollection.insert({
                id: newRecordId(),
                project: projectId,
                user: input.userId,
                role: input.role,
                // The inviter — unlike useCreateProject's self-inserted first
                // owner, whose created_by is '' by convention.
                created_by: user?.id ?? '',
            })
        }),
        ...options,
    })
}

export interface ChangeMemberRoleInput {
    membershipId: string
    role: BoardsMemberRole
}

export function useChangeMemberRole(
    options: { onSuccess?: () => void; onError?: (error: unknown) => void } = {}
) {
    const [membersCollection] = useStore('boards_project_members')

    return useMutation<void, Error, ChangeMemberRoleInput>({
        mutationKey: ['boards', 'member', 'changeRole'],
        mutationFn: mutation(function* (input: ChangeMemberRoleInput) {
            yield membersCollection.update(input.membershipId, draft => {
                draft.role = input.role
            })
        }),
        ...options,
    })
}

/** Remove a member — or leave the board, which is the same delete on your own
 *  row. */
export function useRemoveMember(
    options: { onSuccess?: () => void; onError?: (error: unknown) => void } = {}
) {
    const [membersCollection] = useStore('boards_project_members')

    return useMutation<void, Error, string>({
        mutationKey: ['boards', 'member', 'remove'],
        mutationFn: mutation(function* (membershipId: string) {
            yield membersCollection.delete(membershipId)
        }),
        ...options,
    })
}
