import { captureException } from '@tinycld/core/lib/errors'
import { useMutation } from '@tinycld/core/lib/mutations'
import { pb, useStore } from '@tinycld/core/lib/pocketbase'
import type { BoardsSprints } from '../types'

export interface StartSprintInput {
    sprintId: string
    /** `YYYY-MM-DD`; blank keeps what the sprint has, or today for the board's length. */
    start?: string
    end?: string
    name?: string
    goal?: string
}

export type SprintRollover = 'next' | 'new' | 'backlog'

export interface CompleteSprintInput {
    sprintId: string
    /** Required by the server whenever the sprint has unfinished cards. */
    unfinished?: SprintRollover
    /** The planned sprint to roll into, for `next`. */
    nextSprintId?: string
}

export interface CompleteSprintResult {
    sprint: BoardsSprints
    completedCount: number
    completedPoints: number
    rolledCount: number
    /** The sprint the unfinished cards landed in, '' for the backlog. */
    targetSprintId: string
    createdSprint: boolean
}

interface CompletePayload {
    sprint: BoardsSprints
    completed_count: number
    completed_points: number
    rolled_count: number
    target_sprint: string
    created_sprint: boolean
}

/**
 * The two sprint transitions, through their endpoints (endpoints_sprints.go).
 *
 * Not collection updates: a start stamps the commitment and a completion
 * re-files N cards, and both write columns a client is not allowed to
 * (sprint_owned_columns.go). The returned sprint row is written into the
 * local store straight away, the useMoveCardToBoard shape, so the section
 * header changes now rather than a realtime round-trip later. The rolled
 * cards arrive by realtime — they are many rows, and the rollup recount
 * lands with them.
 */
export function useSprintLifecycle() {
    const [sprintsCollection] = useStore('boards_sprints')

    const startSprint = useMutation<BoardsSprints, Error, StartSprintInput>({
        mutationKey: ['boards', 'sprint', 'start'],
        mutationFn: async (input: StartSprintInput) => {
            try {
                const sprint = await pb.send<BoardsSprints>(
                    `/api/boards/sprints/${input.sprintId}/start`,
                    {
                        method: 'POST',
                        body: {
                            start: input.start ?? '',
                            end: input.end ?? '',
                            name: input.name ?? '',
                            goal: input.goal ?? '',
                        },
                    }
                )
                sprintsCollection.utils.writeUpsert(sprint)
                return sprint
            } catch (err) {
                captureException('boards.sprint.start', err, { ...input })
                throw err
            }
        },
    })

    const completeSprint = useMutation<CompleteSprintResult, Error, CompleteSprintInput>({
        mutationKey: ['boards', 'sprint', 'complete'],
        mutationFn: async (input: CompleteSprintInput) => {
            try {
                const payload = await pb.send<CompletePayload>(
                    `/api/boards/sprints/${input.sprintId}/complete`,
                    {
                        method: 'POST',
                        body: {
                            unfinished: input.unfinished ?? '',
                            next_sprint: input.nextSprintId ?? '',
                        },
                    }
                )
                sprintsCollection.utils.writeUpsert(payload.sprint)
                return {
                    sprint: payload.sprint,
                    completedCount: payload.completed_count ?? 0,
                    completedPoints: payload.completed_points ?? 0,
                    rolledCount: payload.rolled_count ?? 0,
                    targetSprintId: payload.target_sprint ?? '',
                    createdSprint: payload.created_sprint ?? false,
                }
            } catch (err) {
                captureException('boards.sprint.complete', err, { ...input })
                throw err
            }
        },
    })

    return { startSprint, completeSprint }
}
