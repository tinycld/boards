import { eq, inArray, or } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useMyLiveQuery } from '@tinycld/core/lib/use-my-live-query'
import { materialize } from 'pbtsdb'
import { useMemo, useRef } from 'react'
import { type BoardViewOptions, buildBoardProject } from '../lib/board-project'
import type { SprintScope, ViewMode } from '../stores/boards-ui-store'
import type { BoardProject } from '../types'
import { useBoardLiveQuery } from './useBoardLiveQuery'
import { useUserRows } from './useUsers'

/**
 * The boards this user belongs to, split live/archived — and NOTHING about
 * their contents.
 *
 * The sidebar needs exactly this and no more, which is the whole reason it is
 * its own hook. Calling `useBoardContent` there instead would fetch and build
 * the ACTIVE board's whole tree, so every card edit re-rendered the sidebar's
 * board list, and the list is unbounded. `useBoardRoute` takes the same care
 * for the same reason.
 *
 * `boards_projects` syncs on demand, so the join reaches each project row by
 * id: served from the store when present, else one batched fetch for every
 * id the memberships name.
 */
export function useBoardList() {
    const [projectsCollection, membersCollection] = useStore(
        'boards_projects',
        'boards_project_members'
    )

    // My memberships, from the membership side: a board created optimistically
    // renders the instant its owner-member row lands locally, instead of
    // waiting for a realtime round-trip on boards_projects.
    const { data: memberRows, isLoading: membersLoading } = useMyLiveQuery((query, { userId }) =>
        query
            .from({ member: membersCollection })
            .where(({ member }) => eq(member.user, userId))
            .select(({ member }) => ({ project: member.project }))
    )

    const projectIds = useMemo(
        () => [...new Set((memberRows ?? []).map(m => m.project))].sort(),
        [memberRows]
    )

    // The projects those memberships name, asked for BY ID rather than reached
    // through a join. boards_projects is on-demand, so the store holds only
    // rows some query requested — and a join condition is not a `where`, so it
    // never becomes a request. A board shared mid-session would then never
    // arrive: its member row lands by realtime, and nothing fetches the
    // project row the join needs (board-visibility.spec.ts pins this).
    //
    // `inArray(id, ...)` is the shape pbtsdb turns into an id subset, so this
    // is one batched request for ids the store lacks and zero requests once
    // they are filed.
    const { data: projectRows, isLoading: projectsFetching } = useLiveQuery(
        query =>
            projectIds.length === 0
                ? null
                : query
                      .from({ project: projectsCollection })
                      .where(({ project }) => inArray(project.id, projectIds)),
        [projectIds, projectsCollection]
    )

    const projectsLoading = membersLoading || (projectIds.length > 0 && projectsFetching)

    // Split by `archived` rather than filtered: the sidebar lists both, in
    // separate sections, and an archived board must still be openable so it
    // can be looked at and restored.
    return useMemo(() => {
        const rows = [...(projectRows ?? [])].sort(
            (a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1)
        )
        return {
            projects: rows.filter(p => !p.archived),
            archivedProjects: rows.filter(p => p.archived),
            projectsLoading,
        }
    }, [projectRows, projectsLoading])
}

/**
 * Which board is on screen: the stored id when it still names a board this
 * user can open, else the first live one.
 *
 * Resolved DURING RENDER rather than synced back to the store with an effect.
 * The persisted id may name a board that was deleted or that this user has
 * been removed from, and on a cold start there is no id at all; both fall back
 * to the first LIVE board — an archived one is only ever active by explicit
 * choice. The store is never corrected — the next explicit setActiveProject
 * overwrites it.
 */
export function resolveActiveProjectId(
    activeProjectId: string | null,
    projects: { id: string }[],
    archivedProjects: { id: string }[]
): string {
    if (activeProjectId && projects.some(p => p.id === activeProjectId)) return activeProjectId
    if (activeProjectId && archivedProjects.some(p => p.id === activeProjectId)) {
        return activeProjectId
    }
    return projects[0]?.id ?? ''
}

/**
 * The scope a view may be narrowed by — every view but the backlog.
 *
 * The backlog IS the multi-sprint view: the active sprint, each planned sprint
 * and the backlog, every one its own section. Narrowing it to a single sprint
 * empties all the other sections, which is exactly what the default 'active'
 * scope did to it — a board scoped to the active sprint showed a backlog whose
 * every other section read as empty.
 *
 * Returns undefined rather than writing 'all' to the store, so switching back
 * to the board restores whatever scope the reader had set there. Pure and
 * exported because that distinction — ignored here, not reset — is the part a
 * later tidy-up would collapse into a setSprintScope call.
 */
export function scopeForView(
    viewMode: ViewMode,
    storedScope: SprintScope
): SprintScope | undefined {
    return viewMode === 'backlog' ? undefined : storedScope
}

/**
 * Every board the caller is a MEMBER of, not archived — whatever their role.
 *
 * Deliberately not `useWritableProjects`, and the difference is load-bearing.
 * The card-link create rule is `writerOf(source) && memberOf(target)`
 * (pb-migrations/1980000016), so membership alone qualifies a board as a link
 * TARGET. Filtering to owner|editor here would hide boards the rules would
 * happily accept — a viewer on the target board can still be linked to, and a
 * picker that omitted those would look like the link was forbidden.
 *
 * The write half is still enforced, just not here: the SOURCE board is the one
 * needing write access, and that is the board the card is already open on.
 */
export function useMemberProjects() {
    const [projectsCollection, membersCollection] = useStore(
        'boards_projects',
        'boards_project_members'
    )
    const { data: rows } = useMyLiveQuery((query, { userId }) =>
        query
            .from({ member: membersCollection })
            .innerJoin({ project: projectsCollection }, ({ member, project }) =>
                eq(member.project, project.id)
            )
            .where(({ member }) => eq(member.user, userId))
    )
    return useMemo(() => selectLinkTargets(rows ?? []), [rows])
}

/**
 * The membership rows that qualify as link TARGETS: every live board, whatever
 * the role.
 *
 * Pure and exported so the role rule is testable without a hook harness —
 * and it is the rule most likely to be "tidied" into a role filter by someone
 * matching it to `useWritableProjects` below. It must not be: the create rule
 * is `writerOf(source) && memberOf(target)`, so a board the caller can only
 * VIEW is still a legitimate target, and filtering it out would make a link
 * the server would accept look forbidden.
 */
export function selectLinkTargets<
    TRow extends { project: { id: string; name: string; archived?: boolean } },
>(rows: TRow[]): TRow['project'][] {
    return rows
        .filter(r => !r.project.archived)
        .map(r => r.project)
        .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The boards the caller may add cards to — owner or editor, not archived.
 * What the "Move to board" picker offers.
 */
export function useWritableProjects() {
    const [projectsCollection, membersCollection] = useStore(
        'boards_projects',
        'boards_project_members'
    )
    const { data: rows } = useMyLiveQuery((query, { userId }) =>
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

/** How the board screen names its board: by id, or by the URL segment (id or slug). */
export type BoardSelector = { id: string } | { segment: string; slug: string }

/**
 * One board's rows, live, in ONE request.
 *
 * The project row is read through a view that fetches the board's
 * back-relations (collections.ts explains the model): PocketBase returns the
 * project with its lists, cards, labels, epics, sprints and card reactions,
 * pbtsdb files each into its own collection and marks the subset for this
 * project complete, and the includes below — each a single-field equality on
 * `project` — are served from the store. Nothing here scopes by user: what
 * authorizes the read is decided server-side by the access rules (a member's
 * membership, or a visitor's `X-Share-Token`), which is why this is
 * useBoardLiveQuery rather than useMyLiveQuery, which disables itself when
 * there is no signed-in user and would leave a public board empty. The board
 * UI therefore has ONE implementation, not a parallel read-only copy.
 *
 * `boards_cards.labels` and `.assignees` are multi-relations (`string[]`),
 * which have no `eq()` correlation an include could use, so buildBoardProject
 * resolves those two by id from the rows this returns and from `users`.
 *
 * `users` is the one separate read: assignees may name someone no longer on
 * the roster, and a share-link visitor may read none at all — buildBoardProject
 * substitutes a placeholder either way.
 */
export function useBoardRows(selector: BoardSelector) {
    const [
        projectsCollection,
        membersCollection,
        listsCollection,
        cardsCollection,
        labelsCollection,
        epicsCollection,
        sprintsCollection,
        reactionsCollection,
        usersCollection,
    ] = useStore(
        'boards_projects',
        'boards_project_members',
        'boards_lists',
        'boards_cards',
        'boards_labels',
        'boards_epics',
        'boards_sprints',
        'boards_card_reactions',
        'users'
    )
    const key = 'id' in selector ? selector.id : selector.segment
    const slug = 'slug' in selector ? selector.slug : ''

    // Every id-or-slug lookup hits the server once (a slug is not an id, and
    // pbtsdb serves only id subsets from the store); a plain id is served from
    // the store when the row is present. Either way the request carries the
    // back-relations, which is what fills the store for the includes.
    const { data, isLoading } = useBoardLiveQuery(
        query => {
            if (!key) return null
            const boardProjects = projectsCollection.fetchRelations(
                'boards_lists_via_project',
                'boards_labels_via_project',
                'boards_epics_via_project',
                'boards_sprints_via_project',
                'boards_cards_via_project',
                'boards_card_reactions_via_project'
            )
            return query
                .from({ project: boardProjects })
                .where(({ project }) =>
                    slug ? or(eq(project.id, key), eq(project.slug, slug)) : eq(project.id, key)
                )
                .select(({ project }) => ({
                    project,
                    lists: materialize(
                        query
                            .from({ list: listsCollection })
                            .where(({ list }) => eq(list.project, project.id))
                    ),
                    cards: materialize(
                        query
                            .from({ card: cardsCollection })
                            .where(({ card }) => eq(card.project, project.id))
                    ),
                    labels: materialize(
                        query
                            .from({ label: labelsCollection })
                            .where(({ label }) => eq(label.project, project.id))
                    ),
                    epics: materialize(
                        query
                            .from({ epic: epicsCollection })
                            .where(({ epic }) => eq(epic.project, project.id))
                    ),
                    sprints: materialize(
                        query
                            .from({ sprint: sprintsCollection })
                            .where(({ sprint }) => eq(sprint.project, project.id))
                    ),
                    reactions: materialize(
                        query
                            .from({ reaction: reactionsCollection })
                            .where(({ reaction }) => eq(reaction.project, project.id))
                    ),
                    // The roster, joined to users for names; the join reads the
                    // optimistic local store, so a just-added member renders
                    // before the realtime round-trip.
                    //
                    // A share-link visitor legally reads NOTHING here: the
                    // roster rule is member-AND-non-guest, and 1980000003
                    // deliberately adds no token disjunct to it. The avatar
                    // stack is empty for them, which is the point — a link must
                    // not hand out the org's member names and emails.
                    members: materialize(
                        query
                            .from({ member: membersCollection })
                            .innerJoin({ user: usersCollection }, ({ member, user }) =>
                                eq(member.user, user.id)
                            )
                            .where(({ member }) => eq(member.project, project.id))
                    ),
                }))
                .findOne()
        },
        [
            key,
            slug,
            projectsCollection,
            membersCollection,
            listsCollection,
            cardsCollection,
            labelsCollection,
            epicsCollection,
            sprintsCollection,
            reactionsCollection,
            usersCollection,
        ]
    )
    const users = useUserRows()

    return { rows: data ?? null, users, isLoading }
}

export type BoardRows = ReturnType<typeof useBoardRows>

/**
 * The board tree over the rows, with the previous-tree structural sharing.
 *
 * The include query re-emits on any child change and the users read on any
 * org-wide user write, so the build reconciles against the previous tree:
 * value-equal nodes keep their identity, and when nothing changed the
 * previous PROJECT comes back — the canvas doesn't re-render at all. The ref
 * write during render is the standard previous-value pattern; a StrictMode
 * double render just feeds the second pass an equal tree, which shares back
 * to the same object.
 */
export function useBoardTree({ rows, users, isLoading }: BoardRows, view?: BoardViewOptions) {
    const previousProjectRef = useRef<BoardProject | null>(null)
    const project = useMemo(
        () =>
            buildBoardProject(
                {
                    project: rows?.project,
                    lists: rows?.lists ?? [],
                    cards: rows?.cards ?? [],
                    labels: rows?.labels ?? [],
                    epics: rows?.epics ?? [],
                    sprints: rows?.sprints ?? [],
                    members: (rows?.members ?? []).map(r => r.user),
                    users: users ?? [],
                    view,
                },
                previousProjectRef.current
            ),
        [rows, users, view]
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

    return { project, cardCount, isLoading }
}

/**
 * One board's content, by id: the rows and the tree in one call, for the
 * screens that hold only an id — the share-link visitor (whose token
 * metadata names the board) and the cross-board pickers. The board route
 * itself composes the two halves so the reader's view can be computed from
 * the resolved project id in between.
 */
export function useBoardContent(projectId: string, view?: BoardViewOptions) {
    return useBoardTree(useBoardRows({ id: projectId }), view)
}
