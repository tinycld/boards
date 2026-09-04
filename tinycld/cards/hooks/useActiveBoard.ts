import { eq } from '@tanstack/db'
import { useAuth } from '@tinycld/core/lib/auth'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useMemo, useRef } from 'react'
import { type BoardViewOptions, buildBoardProject } from '../lib/board-project'
import { selectBoardFilter, selectBoardSort, useCardsUIStore } from '../stores/cards-ui-store'
import type { BoardProject } from '../types'
import { useBoardLiveQuery } from './useBoardLiveQuery'

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
    const [projectsCollection, membersCollection] = useStore(
        'cards_projects',
        'cards_project_members'
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

    // Split by `archived` rather than filtered: the sidebar lists both, in
    // separate sections, and an archived board must still be openable so it
    // can be looked at and restored.
    const { projects, archivedProjects } = useMemo(() => {
        const rows = (projectRows ?? [])
            .map(r => r.project)
            .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
        return {
            projects: rows.filter(p => !p.archived),
            archivedProjects: rows.filter(p => p.archived),
        }
    }, [projectRows])

    // Resolve the active board DURING RENDER rather than syncing it back to the
    // store with an effect. The persisted id may name a board that was deleted
    // or that this user has been removed from, and on a cold start there is no
    // id at all; both fall back to the first LIVE board — an archived one is
    // only ever active by explicit choice. The store is never corrected — the
    // next explicit setActiveProject overwrites it.
    const projectId = useMemo(() => {
        if (activeProjectId && projects.some(p => p.id === activeProjectId)) return activeProjectId
        if (activeProjectId && archivedProjects.some(p => p.id === activeProjectId)) {
            return activeProjectId
        }
        return projects[0]?.id ?? ''
    }, [activeProjectId, projects, archivedProjects])

    const isArchived = archivedProjects.some(p => p.id === projectId)

    // The per-user view: filter + sort for THIS board, and who "me" is. The
    // selectors return shared constants when nothing is set, so the memo
    // below only rebuilds when a facet actually changes.
    const filter = useCardsUIStore(s => selectBoardFilter(s, projectId))
    const sort = useCardsUIStore(s => selectBoardSort(s, projectId))
    const { user } = useAuth({ throwIfAnon: false })
    const userId = user?.id ?? ''
    const view = useMemo<BoardViewOptions>(() => ({ filter, sort, userId }), [filter, sort, userId])

    const { project, cardCount, isLoading: contentLoading } = useBoardContent(projectId, view)

    return {
        projects,
        archivedProjects,
        project,
        isArchived,
        cardCount,
        isLoading: projectsLoading || contentLoading,
        hasProjects: projects.length > 0 || isArchived,
    }
}

/**
 * The boards the caller may add cards to — owner or editor, not archived.
 * What the "Move to board" picker offers.
 */
export function useWritableProjects() {
    const [projectsCollection, membersCollection] = useStore(
        'cards_projects',
        'cards_project_members'
    )
    const { data: rows } = useOrgLiveQuery((query, { userId }) =>
        query
            .from({ member: membersCollection })
            .innerJoin({ project: projectsCollection }, ({ member, project }) =>
                eq(member.project, project.id)
            )
            .where(({ member }) => eq(member.user, userId))
    )
    return useMemo(
        () =>
            (rows ?? [])
                .filter(
                    r =>
                        !r.project.archived &&
                        (r.member.role === 'owner' || r.member.role === 'editor')
                )
                .map(r => r.project)
                .sort((a, b) => a.name.localeCompare(b.name)),
        [rows]
    )
}

/**
 * One board's content, by id.
 *
 * Split out of useActiveBoard so a SHARE-LINK VISITOR renders the same tree
 * through the same queries. Nothing here scopes by user — every query filters
 * on the project id, and what authorizes it is decided server-side by the
 * access rules: a member's membership, or a visitor's `X-Share-Token`. That is
 * why these use useBoardLiveQuery rather than useOrgLiveQuery, which disables
 * itself when there is no signed-in user and would leave a public board empty.
 *
 * The board UI therefore has ONE implementation, not a parallel read-only copy
 * that drifts from it.
 */
export function useBoardContent(projectId: string, view?: BoardViewOptions) {
    const [
        projectsCollection,
        membersCollection,
        listsCollection,
        cardsCollection,
        labelsCollection,
        epicsCollection,
        usersCollection,
    ] = useStore(
        'cards_projects',
        'cards_project_members',
        'cards_lists',
        'cards_cards',
        'cards_labels',
        'cards_epics',
        'users'
    )

    // A visitor reaches the board by id, so the project row is read directly
    // rather than through the membership join useActiveBoard uses to LIST
    // boards. For a member the rules resolve it via membership; for a visitor,
    // via the token.
    const { data: projectRows, isLoading: projectLoading } = useBoardLiveQuery(
        query => {
            if (!projectId) return null
            return query
                .from({ project: projectsCollection })
                .where(({ project }) => eq(project.id, projectId))
        },
        [projectId, projectsCollection]
    )

    const { data: listRows, isLoading: listsLoading } = useBoardLiveQuery(
        query => {
            if (!projectId) return null
            return query
                .from({ list: listsCollection })
                .where(({ list }) => eq(list.project, projectId))
        },
        [projectId, listsCollection]
    )

    const { data: cardRows, isLoading: cardsLoading } = useBoardLiveQuery(
        query => {
            if (!projectId) return null
            return query
                .from({ card: cardsCollection })
                .where(({ card }) => eq(card.project, projectId))
        },
        [projectId, cardsCollection]
    )

    const { data: labelRows } = useBoardLiveQuery(
        query => {
            if (!projectId) return null
            return query
                .from({ label: labelsCollection })
                .where(({ label }) => eq(label.project, projectId))
        },
        [projectId, labelsCollection]
    )

    const { data: epicRows } = useBoardLiveQuery(
        query => {
            if (!projectId) return null
            return query
                .from({ epic: epicsCollection })
                .where(({ epic }) => eq(epic.project, projectId))
        },
        [projectId, epicsCollection]
    )

    // The roster, joined to users for names. cards_project_members does expand
    // `user`, but a join reads from the optimistic local store where the expand
    // waits on a realtime round-trip — the same reasoning as the project query.
    //
    // A share-link visitor legally reads NOTHING here: the roster rule is
    // member-AND-non-guest, and 1980000003 deliberately adds no token disjunct
    // to it. The avatar stack is empty for them, which is the point — a link
    // must not hand out the org's member names and emails.
    const { data: memberRows } = useBoardLiveQuery(
        query => {
            if (!projectId) return null
            return query
                .from({ member: membersCollection })
                .innerJoin({ user: usersCollection }, ({ member, user }) =>
                    eq(member.user, user.id)
                )
                .where(({ member }) => eq(member.project, projectId))
        },
        [projectId, membersCollection, usersCollection]
    )

    // Every user the client has synced, for resolving assignees. Deliberately
    // NOT the roster: someone removed from the project keeps their id on the
    // cards they were assigned, and must still render.
    //
    // Also empty for a visitor — core's users rule admits only a non-guest
    // member or your own row. buildBoardProject substitutes a placeholder for
    // an assignee it cannot resolve, so a shared board shows THAT a card is
    // assigned without naming who.
    const { data: userRows } = useBoardLiveQuery(
        query => query.from({ user: usersCollection }),
        [usersCollection]
    )

    // The queries above re-emit far more often than this board's content
    // changes (users and the membership join react to org-wide writes), so the
    // build reconciles against the previous tree: value-equal nodes keep their
    // identity, and when nothing changed the previous PROJECT comes back — the
    // canvas doesn't re-render at all. The ref write during render is the
    // standard previous-value pattern; a StrictMode double render just feeds
    // the second pass an equal tree, which shares back to the same object.
    const previousProjectRef = useRef<BoardProject | null>(null)
    const project = useMemo(
        () =>
            buildBoardProject(
                {
                    project: (projectRows ?? [])[0],
                    lists: listRows ?? [],
                    cards: cardRows ?? [],
                    labels: labelRows ?? [],
                    epics: epicRows ?? [],
                    members: (memberRows ?? []).map(r => r.user),
                    users: userRows ?? [],
                    view,
                },
                previousProjectRef.current
            ),
        [projectRows, listRows, cardRows, labelRows, epicRows, memberRows, userRows, view]
    )
    previousProjectRef.current = project

    // Unplaced cards count too: they are real cards the user created, briefly
    // waiting on their list row to sync.
    const cardCount = useMemo(
        () =>
            (project?.lists.reduce((total, list) => total + list.cards.length, 0) ?? 0) +
            (project?.unplacedCards.length ?? 0),
        [project]
    )

    return {
        project,
        cardCount,
        isLoading: projectLoading || listsLoading || cardsLoading,
    }
}
