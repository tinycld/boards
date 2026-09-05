import { useAuth } from '@tinycld/core/lib/auth'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'
import { rankBetween } from '../lib/rank'
import type { BoardSprint } from '../types'

export interface CreateSprintInput {
    name: string
    goal: string
    /** `YYYY-MM-DD` or '' — a planned sprint may be undated. */
    start: string
    end: string
    /** The planned sprints in rank order; the new one lands after the last. */
    after: BoardSprint[]
}

export interface UpdateSprintInput {
    sprintId: string
    name?: string
    goal?: string
    start?: string
    end?: string
    position?: string
}

function appendRank(existing: BoardSprint[]): string {
    const last = existing.at(-1)
    return rankBetween(last ? last.position : null, null)
}

/**
 * Project-scoped sprint CRUD — the useEpicMutations shape.
 *
 * Only the columns a client owns are written. `number` is allocated by the
 * server before the row lands (sprint_number.go), `state` is always
 * `planned` here — starting and completing are the two endpoints
 * useSprintLifecycle drives, because both stamp numbers a client must not
 * write — and the rollup and lifecycle stamps are absent from every write
 * (sprint_owned_columns.go would zero or restore them anyway).
 */
export function useSprintMutations(projectId: string) {
    const [sprintsCollection] = useStore('boards_sprints')
    // Non-throwing for the reason useCreateProject gives: the hooks are
    // constructed on the public board too.
    const { user } = useAuth({ throwIfAnon: false })

    const createSprint = useMutation<string, Error, CreateSprintInput>({
        mutationKey: ['boards', 'sprint', 'create'],
        mutationFn: mutation(function* (input: CreateSprintInput) {
            const sprintId = newRecordId()
            yield sprintsCollection.insert({
                id: sprintId,
                project: projectId,
                name: input.name,
                goal: input.goal,
                start: input.start,
                end: input.end,
                state: 'planned',
                // Appended, so a new sprint lands after the ones already
                // planned rather than jumping ahead of them.
                position: appendRank(input.after),
                created_by: user?.id ?? '',
            })
            return sprintId
        }),
    })

    const updateSprint = useMutation<void, Error, UpdateSprintInput>({
        mutationKey: ['boards', 'sprint', 'update'],
        mutationFn: mutation(function* (input: UpdateSprintInput) {
            yield sprintsCollection.update(input.sprintId, draft => {
                if (input.name !== undefined) draft.name = input.name
                if (input.goal !== undefined) draft.goal = input.goal
                if (input.start !== undefined) draft.start = input.start
                if (input.end !== undefined) draft.end = input.end
                if (input.position !== undefined) draft.position = input.position
            })
        }),
    })

    /**
     * Delete a sprint. `boards_cards.sprint` is cascadeDelete FALSE
     * (1980000018), so its cards go back to the backlog rather than being
     * destroyed — the read side resolves the dangling id to null, exactly as
     * it does for a deleted epic.
     */
    const deleteSprint = useMutation<void, Error, string>({
        mutationKey: ['boards', 'sprint', 'delete'],
        mutationFn: mutation(function* (sprintId: string) {
            yield sprintsCollection.delete(sprintId)
        }),
    })

    return { createSprint, updateSprint, deleteSprint }
}
