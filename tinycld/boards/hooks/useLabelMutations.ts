import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'

export interface CreateLabelInput {
    name: string
    color: string
}

export interface UpdateLabelInput {
    labelId: string
    name?: string
    color?: string
}

/**
 * Project-scoped label CRUD.
 *
 * Boards does NOT use core's label system (`labels` + `label_assignments`),
 * despite it existing and being used by mail and contacts. Core's assignments
 * are PER-USER PRIVATE and its labels are workspace-global: on a shared board
 * every member would see only their own label assignments on cards everyone
 * else can read. A kanban label is a property of the card, visible to the whole
 * team, which is why `boards_labels` is project-scoped and assignment is a
 * multi-relation on the card itself.
 *
 * Note `(project, name)` is UNIQUE — two labels called "bug" on one board are
 * indistinguishable in the UI — so a duplicate name is rejected by the
 * database. The dialog surfaces that as a field error.
 */
export function useLabelMutations(projectId: string) {
    const [labelsCollection] = useStore('boards_labels')

    const createLabel = useMutation<string, Error, CreateLabelInput>({
        mutationKey: ['boards', 'label', 'create'],
        mutationFn: mutation(function* (input: CreateLabelInput) {
            const labelId = newRecordId()
            yield labelsCollection.insert({
                id: labelId,
                project: projectId,
                name: input.name,
                color: input.color,
            })
            return labelId
        }),
    })

    const updateLabel = useMutation<void, Error, UpdateLabelInput>({
        mutationKey: ['boards', 'label', 'update'],
        mutationFn: mutation(function* (input: UpdateLabelInput) {
            yield labelsCollection.update(input.labelId, draft => {
                if (input.name !== undefined) draft.name = input.name
                if (input.color !== undefined) draft.color = input.color
            })
        }),
    })

    /**
     * Delete a label from the board.
     *
     * `boards_cards.labels` is a relation with cascadeDelete FALSE, so deleting
     * a label leaves its id behind on every card that carried it. That is
     * handled on the read side rather than by rewriting every card here:
     * `toBoardCard` drops ids it cannot resolve. A client-side fan-out over
     * every affected card would be a burst of writes that a concurrent editor
     * could interleave with.
     */
    const deleteLabel = useMutation<void, Error, string>({
        mutationKey: ['boards', 'label', 'delete'],
        mutationFn: mutation(function* (labelId: string) {
            yield labelsCollection.delete(labelId)
        }),
    })

    return { createLabel, updateLabel, deleteLabel }
}
