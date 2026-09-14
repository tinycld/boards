import { eq } from '@tanstack/db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useMyLiveQuery } from '@tinycld/core/lib/use-my-live-query'
import { useEffect, useRef } from 'react'
import { revokedProjectIds } from '../lib/membership-sync'

/**
 * Keep the board list live as MY memberships change.
 *
 * Granting a membership makes an existing board readable without changing
 * it, so PocketBase emits no event for the board. The membership row IS the
 * event: its rule carries a bare `user = @request.auth.id`, so my own rows
 * reach this client live, and boards_project_members always carries its board
 * (collections.ts), so the grant arrives with the board and pbtsdb files it.
 * On a grant this subscription's whole job is to exist.
 *
 * A revocation is the same event in reverse, but the board's rows stay in the
 * store — the rule now hides them and nothing will say so — so they are
 * dropped here, cached children included, so a re-shared board cannot
 * resurrect a stale thread.
 */
export function useMembershipSync() {
    const [
        membersCollection,
        projectsCollection,
        listsCollection,
        cardsCollection,
        labelsCollection,
        checklistCollection,
        commentsCollection,
        attachmentsCollection,
    ] = useStore(
        'boards_project_members',
        'boards_projects',
        'boards_lists',
        'boards_cards',
        'boards_labels',
        'boards_checklist_items',
        'boards_comments',
        'boards_attachments'
    )

    const { data: mine, isReady } = useMyLiveQuery((query, { userId }) =>
        query
            .from({ member: membersCollection })
            .where(({ member }) => eq(member.user, userId))
            .select(({ member }) => ({ project: member.project }))
    )

    // Sorted + joined so an order-only difference in query emission is not a
    // "change"; the ref compare below keys on this string.
    const membershipKey = (mine ?? [])
        .map(m => m.project)
        .sort()
        .join(' ')

    const previousKeyRef = useRef<string | null>(null)
    useEffect(() => {
        // Baseline only once the query has SETTLED: the first emissions are
        // the store filling up, not revocations.
        if (!isReady) return
        const previousKey = previousKeyRef.current
        previousKeyRef.current = membershipKey
        if (previousKey === null || previousKey === membershipKey) return

        const children = [
            membersCollection,
            listsCollection,
            cardsCollection,
            labelsCollection,
            checklistCollection,
            commentsCollection,
            attachmentsCollection,
        ]
        for (const projectId of revokedProjectIds(
            previousKey.split(' '),
            membershipKey.split(' ')
        )) {
            for (const collection of children) {
                const keys: string[] = []
                for (const [key, row] of collection.entries()) {
                    if ((row as { project?: string }).project === projectId) keys.push(String(key))
                }
                if (keys.length > 0) collection.utils.writeDelete(keys)
            }
            projectsCollection.utils.writeDelete(projectId)
        }
    }, [
        isReady,
        membershipKey,
        membersCollection,
        projectsCollection,
        listsCollection,
        cardsCollection,
        labelsCollection,
        checklistCollection,
        commentsCollection,
        attachmentsCollection,
    ])
}
