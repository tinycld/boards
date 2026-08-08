import { useAuth } from '@tinycld/core/lib/auth'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'
import { initialRanks } from '../lib/rank'
import { useCardsUIStore } from '../stores/cards-ui-store'

/**
 * The columns a new board starts with.
 *
 * A board with no lists renders the empty state, whose only affordance is "add
 * list" — a dead end for someone who just asked for a board. Every kanban tool
 * ships default columns.
 *
 * The last one carries `is_done`, which is not decoration: BoardColumn,
 * BoardCard and ListStepper all have done-state rendering paths that stay dead
 * code until some list sets it.
 */
const DEFAULT_LISTS = [
    { name: 'To do', isDone: false },
    { name: 'Doing', isDone: false },
    { name: 'Done', isDone: true },
] as const

export interface CreateProjectInput {
    name: string
    color: string
}

export interface UpdateProjectInput {
    projectId: string
    name?: string
    color?: string
}

/** Rename a board or change its color. Owner-only, enforced by the PB rule. */
export function useUpdateProject() {
    const [projectsCollection] = useStore('cards_projects')

    return useMutation<void, Error, UpdateProjectInput>({
        mutationKey: ['cards', 'project', 'update'],
        mutationFn: mutation(function* (input: UpdateProjectInput) {
            yield projectsCollection.update(input.projectId, draft => {
                if (input.name !== undefined) draft.name = input.name
                if (input.color !== undefined) draft.color = input.color
            })
        }),
    })
}

/**
 * Archive a board — the only removal the UI offers.
 *
 * `useActiveBoard` already filters archived projects out of the sidebar, so the
 * board disappears without destroying its lists, cards, members or history.
 * There is deliberately NO delete: a project cascades to everything beneath it,
 * and an owner who wants a board gone is almost always saying "get it out of my
 * sidebar", not "destroy six months of work".
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
    const { user } = useAuth()
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
                color: input.color,
                visibility: 'private',
                created_by: userId,
                archived: false,
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
                    is_done: list.isDone,
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
