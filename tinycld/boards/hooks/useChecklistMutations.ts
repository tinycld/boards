import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'

export interface CreateChecklistItemInput {
    title: string
    /** Computed by lib/move.ts against the card's existing items. */
    position: string
}

/**
 * Checklist item mutations, all scoped to one card.
 *
 * `boards_checklist_items` syncs on-demand — a client fetches it only for the
 * card it has open — which affects reads, not writes. Every write here also
 * triggers the server's recount, so the board card's "3/7" badge updates
 * without the board ever syncing the items themselves.
 *
 * `project` is written on every insert even though `card` implies it: the
 * access rules resolve membership through the denormalized project relation,
 * exactly as they do for cards.
 */
export function useChecklistMutations(cardId: string, projectId: string) {
    const [itemsCollection] = useStore('boards_checklist_items')

    const createItem = useMutation<string, Error, CreateChecklistItemInput>({
        mutationKey: ['boards', 'checklist', 'create'],
        mutationFn: mutation(function* (input: CreateChecklistItemInput) {
            const itemId = newRecordId()
            yield itemsCollection.insert({
                id: itemId,
                card: cardId,
                project: projectId,
                title: input.title,
                position: input.position,
                is_done: false,
            })
            return itemId
        }),
    })

    const toggleItem = useMutation<void, Error, { itemId: string; isDone: boolean }>({
        mutationKey: ['boards', 'checklist', 'toggle'],
        mutationFn: mutation(function* ({ itemId, isDone }) {
            yield itemsCollection.update(itemId, draft => {
                draft.is_done = isDone
            })
        }),
    })

    const renameItem = useMutation<void, Error, { itemId: string; title: string }>({
        mutationKey: ['boards', 'checklist', 'rename'],
        mutationFn: mutation(function* ({ itemId, title }) {
            yield itemsCollection.update(itemId, draft => {
                draft.title = title
            })
        }),
    })

    const deleteItem = useMutation<void, Error, string>({
        mutationKey: ['boards', 'checklist', 'delete'],
        mutationFn: mutation(function* (itemId: string) {
            yield itemsCollection.delete(itemId)
        }),
    })

    // One row, one field — like useMoveCard, this is what keeps an optimistic
    // reorder from ever renumbering the sibling rows.
    const moveItem = useMutation<void, Error, { itemId: string; position: string }>({
        mutationKey: ['boards', 'checklist', 'move'],
        mutationFn: mutation(function* ({ itemId, position }) {
            yield itemsCollection.update(itemId, draft => {
                draft.position = position
            })
        }),
    })

    return { createItem, toggleItem, renameItem, deleteItem, moveItem }
}
