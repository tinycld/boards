import { eq } from '@tanstack/db'
import { captureException } from '@tinycld/core/lib/errors'
import { usePocketBase, useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useEffect, useRef } from 'react'
import { visibilityChanges } from '../lib/membership-visibility'
import type {
    BoardsCards,
    BoardsLabels,
    BoardsLists,
    BoardsProjectMembers,
    BoardsProjects,
    Users,
} from '../types'

/**
 * Keep board visibility live as MY memberships change.
 *
 * Rule-gated visibility has no realtime story of its own: granting or
 * revoking a membership makes EXISTING rows readable or unreadable, and
 * PocketBase only emits events for records that change — the project, its
 * lists, its cards all stayed byte-identical. Without this hook a board
 * shared with you mid-session never appears and a board you were removed
 * from never leaves; you had to exit cards and come back, and CI (where
 * cards is the login landing screen) failed on exactly that.
 *
 * The one deliverable signal is my own member row: its list rule carries a
 * bare `user = @request.auth.id` disjunct, so its create AND delete reach
 * this client regardless of any join. Watch it, and reconcile SURGICALLY
 * (see visibilityChanges for when):
 *
 *   - a grant pulls exactly that project's rows and UPSERTS them. Never a
 *     collection-wide refetch: a full refetch's reconcile deletes synced rows
 *     missing from its snapshot, and a snapshot fetched while another of this
 *     user's sessions (or this one) has writes in flight clobbers those rows
 *     — measured as a freshly created board rendering "0 cards in 3 lists".
 *   - a revocation deletes exactly that project's rows from the local store.
 *     No fetch at all — the rules would refuse it anyway; the ids to drop are
 *     already here.
 *
 * The fetch is read-only REST feeding the pbtsdb synced layer through its own
 * write utils — this hook is sync infrastructure, the same layer pbtsdb's
 * realtime handler writes through, not a component bypassing the store.
 *
 * The on-demand collections (checklist, comments, attachments) need no pull —
 * they fetch per open card — but a revocation drops their cached rows too, so
 * a re-shared board cannot resurrect a stale thread.
 *
 * Mounted app-wide by provider.tsx, so a grant lands even while the user is
 * in another package and the sidebar is ready the moment they arrive.
 */
export function useMembershipVisibilitySync() {
    const pb = usePocketBase()
    const [
        membersCollection,
        projectsCollection,
        listsCollection,
        cardsCollection,
        labelsCollection,
        checklistCollection,
        commentsCollection,
        attachmentsCollection,
        usersCollection,
    ] = useStore(
        'boards_project_members',
        'boards_projects',
        'boards_lists',
        'boards_cards',
        'boards_labels',
        'boards_checklist_items',
        'boards_comments',
        'boards_attachments',
        'users'
    )

    const { data: memberships, isReady } = useOrgLiveQuery(
        (query, { userId }) =>
            query
                .from({ member: membersCollection })
                .where(({ member }) => eq(member.user, userId))
                .select(({ member }) => ({ id: member.id, project: member.project })),
        []
    )

    // Sorted + joined so an order-only difference in query emission is not a
    // "change"; the ref compare below keys on this string.
    const membershipKey = (memberships ?? [])
        .map(m => m.project)
        .sort()
        .join(' ')

    const previousKeyRef = useRef<string | null>(null)
    useEffect(() => {
        // Baseline only once the query has SETTLED: the first emissions are
        // the store filling up, and treating those as grants would pull every
        // board again on every app load.
        if (!isReady) return
        const previousKey = previousKeyRef.current
        previousKeyRef.current = membershipKey
        if (previousKey === null || previousKey === membershipKey) return

        const { granted, revoked } = visibilityChanges(
            previousKey.split(' ').filter(Boolean),
            membershipKey.split(' ').filter(Boolean),
            projectId => projectsCollection.has(projectId)
        )

        const allChildren = [
            membersCollection,
            listsCollection,
            cardsCollection,
            labelsCollection,
            checklistCollection,
            commentsCollection,
            attachmentsCollection,
        ]

        for (const projectId of granted) {
            const filter = pb.filter('project = {:id}', { id: projectId })
            Promise.all([
                pb.collection('boards_projects').getOne<BoardsProjects>(projectId),
                pb
                    .collection('boards_project_members')
                    .getFullList<BoardsProjectMembers & { expand?: { user?: Users } }>({
                        filter,
                        expand: 'user',
                    }),
                pb.collection('boards_lists').getFullList<BoardsLists>({ filter }),
                pb.collection('boards_cards').getFullList<BoardsCards>({ filter }),
                pb.collection('boards_labels').getFullList<BoardsLabels>({ filter }),
            ])
                .then(([project, members, lists, cards, labels]) => {
                    projectsCollection.utils.writeUpsert(project)
                    // Expand is stripped before the upsert — the collection's
                    // row type carries a fully-expanded shape this partial
                    // fetch does not satisfy, and consumers resolve members
                    // against the users store anyway (the realtime path
                    // delivers expand-less rows too).
                    membersCollection.utils.writeUpsert(
                        members.map(({ expand, ...member }) => member)
                    )
                    listsCollection.utils.writeUpsert(lists)
                    cardsCollection.utils.writeUpsert(cards)
                    labelsCollection.utils.writeUpsert(labels)
                    // The roster's names resolve against the eager users
                    // store, and a just-shared board's co-members may be
                    // people this client has never synced.
                    for (const member of members) {
                        if (member.expand?.user) {
                            usersCollection.utils.writeUpsert(member.expand.user)
                        }
                    }
                })
                .catch(err => {
                    // Swallowed: the board still appears on the next full
                    // sync (navigation or reload); a failed pull must not
                    // take down whatever screen happens to be mounted.
                    captureException('boards.membershipVisibility.pull', err, { projectId })
                })
        }

        for (const projectId of revoked) {
            for (const collection of allChildren) {
                const keys: string[] = []
                for (const [key, row] of collection.entries()) {
                    if ((row as { project?: string }).project === projectId) {
                        keys.push(String(key))
                    }
                }
                if (keys.length > 0) collection.utils.writeDelete(keys)
            }
            projectsCollection.utils.writeDelete(projectId)
        }
    }, [
        isReady,
        membershipKey,
        pb,
        membersCollection,
        projectsCollection,
        listsCollection,
        cardsCollection,
        labelsCollection,
        checklistCollection,
        commentsCollection,
        attachmentsCollection,
        usersCollection,
    ])
}
