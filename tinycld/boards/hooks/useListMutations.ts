import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'
import type { ListCategory } from '../lib/list-category'

export interface CreateListInput {
    name: string
    /** Computed by lib/move.ts against the board's existing columns. */
    position: string
}

/**
 * Add a column to a board.
 *
 * The category is `todo`: which column means finished is a property of a
 * board's workflow, not of a newly added column, and a board created through
 * useCreateProject already has one. It is set from the column menu afterwards.
 */
export function useCreateList(projectId: string) {
    const [listsCollection] = useStore('boards_lists')

    return useMutation<string, Error, CreateListInput>({
        mutationKey: ['boards', 'list', 'create'],
        mutationFn: mutation(function* (input: CreateListInput) {
            const listId = newRecordId()

            yield listsCollection.insert({
                id: listId,
                project: projectId,
                name: input.name,
                position: input.position,
                category: 'todo',
            })

            return listId
        }),
    })
}

export interface UpdateListInput {
    listId: string
    name?: string
    category?: ListCategory
    position?: string
}

/**
 * Rename a column, set its status, or move it.
 *
 * All three are one update because they are one row, and a rename that arrives
 * as a separate write from a reorder would render the column in its old place
 * under its new name for a frame.
 */
export function useUpdateList() {
    const [listsCollection] = useStore('boards_lists')

    return useMutation<void, Error, UpdateListInput>({
        mutationKey: ['boards', 'list', 'update'],
        mutationFn: mutation(function* (input: UpdateListInput) {
            yield listsCollection.update(input.listId, draft => {
                if (input.name !== undefined) draft.name = input.name
                if (input.category !== undefined) draft.category = input.category
                if (input.position !== undefined) draft.position = input.position
            })
        }),
    })
}

/**
 * Delete a column.
 *
 * THIS DELETES THE COLUMN'S CARDS. `boards_cards.list` ships
 * `cascadeDelete: true`, so PocketBase removes them server-side — in a hosted
 * tenant as well as the dev shell — and each of those cards cascades on to its
 * own checklist items, comments and attachments.
 *
 * The cascade is invisible from the client, which is exactly why the caller
 * must confirm with the card count in hand. Deleting one row here can destroy
 * hundreds.
 */
export function useDeleteList() {
    const [listsCollection] = useStore('boards_lists')

    return useMutation<void, Error, string>({
        mutationKey: ['boards', 'list', 'delete'],
        mutationFn: mutation(function* (listId: string) {
            yield listsCollection.delete(listId)
        }),
    })
}
