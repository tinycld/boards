import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import type { RowMapper } from '@tinycld/core/lib/forms/host-ui'
import type { ChecklistItem } from '@tinycld/core/lib/forms/values'
import { performMutations } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useRecord } from '@tinycld/core/lib/use-record'
import { rankForAppend } from '../lib/move'
import { initialRanks } from '../lib/rank'

function useItems(recordId: string) {
    const [itemsCollection] = useStore('boards_checklist_items')
    const { data, isReady } = useLiveQuery({
        query: query =>
            query
                .from({ item: itemsCollection })
                .where(({ item }) => eq(item.card, recordId))
                // Ranks are not unique (lib/rank.ts): the id breaks a tie the
                // same way on every client.
                .orderBy(({ item }) => item.position, 'asc')
                .orderBy(({ item }) => item.id, 'asc')
                .select(({ item }) => ({
                    id: item.id,
                    text: item.title,
                    done: item.is_done,
                    position: item.position,
                })),
    })
    return { rows: data ?? [], isReady }
}

/** The card's checklist table, through the engine's checklist kind. */
export const checklistMapper: RowMapper = {
    useRows(recordId) {
        const { rows, isReady } = useItems(recordId)
        return { items: rows.map(({ id, text, done }) => ({ id, text, done })), isReady }
    },
    useMutations(recordId) {
        const [cardsCollection, itemsCollection] = useStore(
            'boards_cards',
            'boards_checklist_items'
        )
        // Every item row carries the board, for its access rule; the card knows it.
        const { record: card } = useRecord(cardsCollection, recordId)
        const { rows } = useItems(recordId)
        const projectId = card?.project ?? ''
        return {
            insert: (item: ChecklistItem) =>
                performMutations(function* () {
                    yield itemsCollection.insert({
                        id: item.id,
                        card: recordId,
                        project: projectId,
                        title: item.text,
                        is_done: item.done,
                        position: rankForAppend(rows),
                    })
                }),
            update: (item: ChecklistItem) =>
                performMutations(function* () {
                    yield itemsCollection.update(item.id, draft => {
                        draft.title = item.text
                        draft.is_done = item.done
                    })
                }),
            remove: (id: string) =>
                performMutations(function* () {
                    yield itemsCollection.delete(id)
                }),
            // The engine hands over the whole order, so every row gets a fresh
            // rank rather than recovering the one that moved.
            reorder: (ids: string[]) => {
                const ranks = initialRanks(ids.length)
                return performMutations(function* () {
                    yield ids.map((id, i) =>
                        itemsCollection.update(id, draft => {
                            draft.position = ranks[i]
                        })
                    )
                })
            },
        }
    },
}
