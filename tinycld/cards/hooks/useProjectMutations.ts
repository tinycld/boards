import { useAuth } from '@tinycld/core/lib/auth'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'
import type { ListCategory } from '../lib/list-category'
import { initialRanks } from '../lib/rank'
import { useCardsUIStore } from '../stores/cards-ui-store'

/**
 * The columns a new board starts with.
 *
 * A board with no lists renders the empty state, whose only affordance is "add
 * list" — a dead end for someone who just asked for a board. Every kanban tool
 * ships default columns.
 *
 * The categories are not decoration: BoardColumn, BoardCard and ListStepper
 * all have closed-state rendering paths that stay dead code until some list
 * is `done`, and the filter's status facet is only useful once the lists
 * disagree.
 */
const DEFAULT_LISTS: { name: string; category: ListCategory }[] = [
    { name: 'To do', category: 'todo' },
    { name: 'Doing', category: 'in_progress' },
    { name: 'Done', category: 'done' },
]

export interface CreateProjectInput {
    name: string
    color: string
    /**
     * The board half of a card key (`OTTER`). '' is allowed and means the board
     * gets no key — the column is optional, and the dialog leaves the field
     * empty when a name yields no usable suggestion.
     */
    slug: string
}

export interface UpdateProjectInput {
    projectId: string
    name?: string
    color?: string
    /**
     * Changing this re-keys every card on the board — OTTER-7 becomes FOX-7 —
     * because a key is formatted from the board's CURRENT slug rather than
     * stored per card. That is the intended behavior (one board, one key
     * prefix), but it does invalidate previously shared links, so a caller
     * offering this should say so.
     */
    slug?: string
    /** Days a card may sit in a done or canceled list before the server archives it; 0 = never. */
    autoArchiveDays?: number
}

/** Rename a board, change its color, or its settings. Owner-only, enforced by the PB rule. */
export function useUpdateProject() {
    const [projectsCollection] = useStore('cards_projects')

    return useMutation<void, Error, UpdateProjectInput>({
        mutationKey: ['cards', 'project', 'update'],
        mutationFn: mutation(function* (input: UpdateProjectInput) {
            yield projectsCollection.update(input.projectId, draft => {
                if (input.name !== undefined) draft.name = input.name
                if (input.color !== undefined) draft.color = input.color
                if (input.slug !== undefined) draft.slug = input.slug
                if (input.autoArchiveDays !== undefined) {
                    draft.auto_archive_days = input.autoArchiveDays
                }
            })
        }),
    })
}

/**
 * Archive a board — the removal the UI offers FIRST.
 *
 * `useActiveBoard` moves archived projects out of the sidebar's Projects list
 * and into its Archived section, so the board disappears from daily view
 * without destroying its lists, cards, members or history. Delete exists too
 * (useDeleteProject) but behind a typed-name confirm: a project cascades to
 * everything beneath it, and an owner who wants a board gone is almost always
 * saying "get it out of my sidebar", not "destroy six months of work".
 */
export function useArchiveProject() {
    const [projectsCollection] = useStore('cards_projects')
    const setActiveProject = useCardsUIStore(s => s.setActiveProject)

    return useMutation<void, Error, string>({
        mutationKey: ['cards', 'project', 'archive'],
        mutationFn: mutation(function* (projectId: string) {
            yield projectsCollection.update(projectId, draft => {
                draft.archived = true
            })
        }),
        // Clearing the stored id lets useActiveBoard fall back to the first
        // remaining board; leaving it would point the store at a project the
        // query no longer returns.
        onSuccess: () => setActiveProject(''),
    })
}

/**
 * Bring an archived board back. The active id is left alone: restoring is
 * done from the board itself (the banner) or the sidebar's Archived section,
 * and in both cases the user wants to stay where they are.
 */
export function useRestoreProject() {
    const [projectsCollection] = useStore('cards_projects')

    return useMutation<void, Error, string>({
        mutationKey: ['cards', 'project', 'restore'],
        mutationFn: mutation(function* (projectId: string) {
            yield projectsCollection.update(projectId, draft => {
                draft.archived = false
            })
        }),
    })
}

/**
 * Delete a board outright. Owner-only by rule.
 *
 * Every child collection relates to `project` with cascadeDelete, so the
 * lists, cards, checklist items, comments, attachments, memberships and share
 * links all go server-side in the same request. Other members see the board
 * vanish through the membership cascade (useMembershipVisibilitySync), and
 * server/realtime.go truncates the board's document journal. Callers MUST
 * confirm first — DeleteBoardDialog requires the name to be typed.
 */
export function useDeleteProject() {
    const [projectsCollection] = useStore('cards_projects')
    const setActiveProject = useCardsUIStore(s => s.setActiveProject)

    return useMutation<void, Error, string>({
        mutationKey: ['cards', 'project', 'delete'],
        mutationFn: mutation(function* (projectId: string) {
            yield projectsCollection.delete(projectId)
        }),
        onSuccess: () => setActiveProject(''),
    })
}

/**
 * Create a board: the project, its owner membership, and its default columns.
 *
 * THE YIELD ORDER IS LOAD-BEARING, and none of these steps can be batched:
 *
 *  1. The project must exist server-side before anything can relate to it.
 *  2. The owner row is admitted by the `bootstrapFirstOwner` branch of
 *     cards_project_members' create rule, which requires the caller to be
 *     inserting THEMSELVES as "owner" while the project still has no members.
 *     It is the only way a board gets its first owner — cards deliberately puts
 *     this in the rule rather than a Go hook, so ownership is established by
 *     the same request that creates the board and no hook has to fire.
 *  3. The lists are admitted by `viaWriter`, which needs that owner row already
 *     committed. They are yielded as an array because they are independent of
 *     each other — that runs them in parallel.
 *
 * `performMutations` awaits each yield's `isPersisted.promise` before resuming,
 * which is exactly the sequencing above.
 */
export function useCreateProject(options: { onError?: (error: unknown) => void } = {}) {
    // Non-throwing: BoardColumn calls the mutation hooks unconditionally, so
    // they are constructed on the PUBLIC board too — where there is no
    // session and the affordances that would invoke them are already gated
    // off. Throwing here made merely RENDERING a shared board an error.
    const { user } = useAuth({ throwIfAnon: false })
    const [projectsCollection, membersCollection, listsCollection] = useStore(
        'cards_projects',
        'cards_project_members',
        'cards_lists'
    )
    const setActiveProject = useCardsUIStore(s => s.setActiveProject)
    const closeNewBoard = useCardsUIStore(s => s.closeNewBoard)

    return useMutation<string, Error, CreateProjectInput>({
        mutationKey: ['cards', 'project', 'create'],
        mutationFn: mutation(function* (input: CreateProjectInput) {
            const userId = user?.id ?? ''
            const projectId = newRecordId()

            yield projectsCollection.insert({
                id: projectId,
                name: input.name,
                slug: input.slug,
                color: input.color,
                visibility: 'private',
                created_by: userId,
                archived: false,
                // 0 is "never"; written rather than left to the column default
                // for the reason every other insert here states its fields.
                auto_archive_days: 0,
            })

            yield membersCollection.insert({
                id: newRecordId(),
                project: projectId,
                user: userId,
                role: 'owner',
                // '' by convention for a self-inserted first owner: there is no
                // other member to have added them.
                created_by: '',
            })

            const ranks = initialRanks(DEFAULT_LISTS.length)
            yield DEFAULT_LISTS.map((list, index) =>
                listsCollection.insert({
                    id: newRecordId(),
                    project: projectId,
                    name: list.name,
                    position: ranks[index] ?? '',
                    category: list.category,
                })
            )

            return projectId
        }),
        onSuccess: projectId => {
            setActiveProject(projectId)
            closeNewBoard()
        },
        // Omitted when the caller passes nothing, so the default error toast +
        // Sentry report stay in place. A form caller passes
        // handleMutationErrorsWithForm to route field errors into the form
        // instead — which REPLACES the default, hence the explicit opt-in.
        ...(options.onError ? { onError: options.onError } : {}),
    })
}
