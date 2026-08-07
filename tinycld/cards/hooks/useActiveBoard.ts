import { eq } from '@tanstack/db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useMemo } from 'react'
import { buildBoardProject } from '../lib/board-project'
import { useCardsUIStore } from '../stores/cards-ui-store'

/**
 * The board, live.
 *
 * Four queries rather than one joined expression, and deliberately so:
 * `.join()` needs a single equality condition, but `cards_cards.labels` and
 * `.assignees` are MULTI-relations — `string[]` columns. There is no `eq()`
 * that joins an array column to a table's id, so those two resolve by id
 * against the eagerly-synced collections instead, exactly as collections.ts
 * says they must (expanding them would ship a duplicate copy of every label and
 * user with every card).
 */
export function useActiveBoard() {
    const [
        projectsCollection,
        membersCollection,
        listsCollection,
        cardsCollection,
        labelsCollection,
        usersCollection,
    ] = useStore(
        'cards_projects',
        'cards_project_members',
        'cards_lists',
        'cards_cards',
        'cards_labels',
        'users'
    )

    const activeProjectId = useCardsUIStore(s => s.activeProjectId)

    // Driven from the MEMBERSHIP side with an innerJoin, following
    // mail's useMailboxes: a board created optimistically renders the instant
    // its owner-member row lands locally, instead of waiting for a realtime
    // round-trip on cards_projects.
    const { data: projectRows, isLoading: projectsLoading } = useOrgLiveQuery((query, { userId }) =>
        query
            .from({ member: membersCollection })
            .innerJoin({ project: projectsCollection }, ({ member, project }) =>
                eq(member.project, project.id)
            )
            .where(({ member }) => eq(member.user, userId))
    )

    const projects = useMemo(() => {
        const rows = (projectRows ?? []).map(r => r.project).filter(p => !p.archived)
        return rows.sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
    }, [projectRows])

    // Resolve the active board DURING RENDER rather than syncing it back to the
    // store with an effect. The persisted id may name a board that was deleted
    // or that this user has been removed from, and on a cold start there is no
    // id at all; both fall back to the first board. The store is never
    // corrected — the next explicit setActiveProject overwrites it.
    const projectId = useMemo(() => {
        if (activeProjectId && projects.some(p => p.id === activeProjectId)) return activeProjectId
        return projects[0]?.id ?? ''
    }, [activeProjectId, projects])

    const { data: listRows, isLoading: listsLoading } = useOrgLiveQuery(
        query => {
            if (!projectId) return null
            return query
                .from({ list: listsCollection })
                .where(({ list }) => eq(list.project, projectId))
        },
        [projectId]
    )

    const { data: cardRows, isLoading: cardsLoading } = useOrgLiveQuery(
        query => {
            if (!projectId) return null
            return query
                .from({ card: cardsCollection })
                .where(({ card }) => eq(card.project, projectId))
        },
        [projectId]
    )

    const { data: labelRows } = useOrgLiveQuery(
        query => {
            if (!projectId) return null
            return query
                .from({ label: labelsCollection })
                .where(({ label }) => eq(label.project, projectId))
        },
        [projectId]
    )

    // The roster, joined to users for names. cards_project_members does expand
    // `user`, but a join reads from the optimistic local store where the expand
    // waits on a realtime round-trip — the same reasoning as the project query.
    const { data: memberRows } = useOrgLiveQuery(
        query => {
            if (!projectId) return null
            return query
                .from({ member: membersCollection })
                .innerJoin({ user: usersCollection }, ({ member, user }) =>
                    eq(member.user, user.id)
                )
                .where(({ member }) => eq(member.project, projectId))
        },
        [projectId]
    )

    // Every user the client has synced, for resolving assignees. Deliberately
    // NOT the roster: someone removed from the project keeps their id on the
    // cards they were assigned, and must still render.
    const { data: userRows } = useOrgLiveQuery(query => query.from({ user: usersCollection }))

    const project = useMemo(
        () =>
            buildBoardProject({
                project: projects.find(p => p.id === projectId),
                lists: listRows ?? [],
                cards: cardRows ?? [],
                labels: labelRows ?? [],
                members: (memberRows ?? []).map(r => r.user),
                users: userRows ?? [],
            }),
        [projects, projectId, listRows, cardRows, labelRows, memberRows, userRows]
    )

    const cardCount = useMemo(
        () => project?.lists.reduce((total, list) => total + list.cards.length, 0) ?? 0,
        [project]
    )

    return {
        projects,
        project,
        cardCount,
        isLoading: projectsLoading || listsLoading || cardsLoading,
        hasProjects: projects.length > 0,
    }
}
