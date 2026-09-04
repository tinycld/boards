import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'
import { rankBetween } from '../lib/rank'
import type { BoardEpic } from '../types'

export interface CreateEpicInput {
    title: string
    color: string
}

export interface UpdateEpicInput {
    epicId: string
    title?: string
    color?: string
    archived?: boolean
}

/**
 * The rank placing a new epic after every existing one. `existing` must be in
 * rank order — BoardProject.epics is (board-project.ts sorts it) — and an empty
 * board yields the first rank.
 */
function appendRank(existing: BoardEpic[]): string {
    const last = existing.at(-1)
    return rankBetween(last ? last.position : null, null)
}

/**
 * Project-scoped epic CRUD.
 *
 * An epic is a grouping of cards by SCOPE, which is why it is a collection
 * rather than a column — see pb-migrations/1980000017 for the contrast with
 * sub-tasks, where a parent is an ordinary card.
 *
 * Unlike `cards_labels` there is no unique index on the title: two epics called
 * "Billing" on one board are confusing but not corrupting, and an epic is
 * renamed far more often than a label. The picker shows them in rank order, so
 * duplicates are at least adjacent to their own history.
 *
 * `points_total` / `points_done` are absent from every write here: the server
 * owns them (server/epic_rollup.go recomputes from the cards actually filed),
 * and a client value would be overwritten on the next card write anyway.
 */
export function useEpicMutations(projectId: string) {
    const [epicsCollection] = useStore('cards_epics')

    const createEpic = useMutation<string, Error, CreateEpicInput & { after: BoardEpic[] }>({
        mutationKey: ['cards', 'epic', 'create'],
        mutationFn: mutation(function* (input: CreateEpicInput & { after: BoardEpic[] }) {
            const epicId = newRecordId()
            yield epicsCollection.insert({
                id: epicId,
                project: projectId,
                title: input.title,
                description: '',
                color: input.color,
                // Appended, so a new epic lands at the end of the plan rather
                // than jumping to the top of a list someone has ordered.
                position: appendRank(input.after),
                archived: false,
                points_total: 0,
                points_done: 0,
            })
            return epicId
        }),
    })

    const updateEpic = useMutation<void, Error, UpdateEpicInput>({
        mutationKey: ['cards', 'epic', 'update'],
        mutationFn: mutation(function* (input: UpdateEpicInput) {
            yield epicsCollection.update(input.epicId, draft => {
                if (input.title !== undefined) draft.title = input.title
                if (input.color !== undefined) draft.color = input.color
                if (input.archived !== undefined) draft.archived = input.archived
            })
        }),
    })

    /**
     * Delete an epic from the board.
     *
     * `cards_cards.epic` is cascadeDelete FALSE (1980000017), so this leaves
     * the id behind on every card filed under it — deliberately: those cards
     * are real work, and destroying nine of them to tidy one container is
     * unrecoverable. The read side handles it, exactly as it does for labels
     * and for a deleted parent: `toBoardCard` resolves an unknown id to null
     * and the card renders as unfiled.
     *
     * ARCHIVING is the ordinary way to close an epic (updateEpic), and it is
     * what the UI offers first: an archived epic keeps its cards filed and its
     * name resolvable in their history.
     */
    const deleteEpic = useMutation<void, Error, string>({
        mutationKey: ['cards', 'epic', 'delete'],
        mutationFn: mutation(function* (epicId: string) {
            yield epicsCollection.delete(epicId)
        }),
    })

    return { createEpic, updateEpic, deleteEpic }
}
