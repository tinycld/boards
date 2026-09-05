import { captureException, errorToString } from '@tinycld/core/lib/errors'
import { useMutation } from '@tinycld/core/lib/mutations'
import { notify } from '@tinycld/core/lib/notify'
import { useStore } from '@tinycld/core/lib/pocketbase'
import type { CardEntry } from '../lib/board-cards'
import { highestRank } from '../lib/move'
import type { CardPriority } from '../lib/priority'
import { ranksAfter } from '../lib/rank'
import type { BoardListView } from '../types'

/**
 * The bulk writes behind the selection bar. Mail's useMailBulkActions is the
 * shape; the one place this departs from it is partial failure, below.
 *
 * Every action here is a one-row update on `boards_cards`, which is why item 19
 * needed no migration and no endpoint: the batching is the whole feature. The
 * exception is a cross-board move, which cannot be a collection write at all —
 * see useBulkMoveToBoard.
 */

/**
 * PARTIAL FAILURE IS THE POINT, and it is why these do not use the generator's
 * array yield.
 *
 * `yield [tx, tx, …]` awaits with `Promise.all`, which rejects on the FIRST
 * rejection: the remaining transactions are neither awaited nor reported, so a
 * selection where one card is unwritable (readable but not editable — a real
 * case on a shared board) reports as a flat failure and says nothing about the
 * eleven that landed. `allSettled` keeps every outcome, so the toast can say
 * what actually happened.
 *
 * Throwing on ANY failure is deliberate even though most of the batch may have
 * landed: `onSuccess` is what clears the selection, so a partial failure leaves
 * it standing and the user can retry without picking the cards again. The
 * writes that succeeded are not undone — they are real — and the toast names
 * the split so a retry is an informed one.
 */
async function settleAll(transactions: { isPersisted: { promise: Promise<unknown> } }[]) {
    const results = await Promise.allSettled(transactions.map(tx => tx.isPersisted.promise))
    const failed = results.filter(result => result.status === 'rejected')
    if (failed.length === 0) return
    const reason = failed[0].status === 'rejected' ? failed[0].reason : undefined
    throw new BulkPartialError(failed.length, results.length, reason)
}

/** Carries the counts so the toast can name them rather than just "failed". */
export class BulkPartialError extends Error {
    constructor(
        readonly failedCount: number,
        readonly totalCount: number,
        readonly cause?: unknown
    ) {
        const succeeded = totalCount - failedCount
        super(
            succeeded > 0
                ? `${succeeded} of ${totalCount} updated; ${failedCount} could not be changed`
                : `Could not change ${failedCount === 1 ? 'the card' : `any of the ${totalCount} cards`}`
        )
        this.name = 'BulkPartialError'
    }
}

export interface SetRelationInput {
    field: 'labels' | 'assignees'
    id: string
    /**
     * Decided by the CALLER from the mixed state, not per card — see the
     * mutation's comment.
     */
    isAdding: boolean
}

export function useCardBulkActions(cards: CardEntry[], clearSelection: () => void) {
    const [cardsCollection] = useStore('boards_cards')

    // A bulk action failing across N cards must not be silent — and must not
    // raise N toasts either. One capture, one toast, with the count, mirroring
    // mail's bulkActionFailed.
    const bulkActionFailed = (action: string) => (error: unknown) => {
        captureException(`boards.bulk.${action}`, error, { count: cards.length })
        notify.emit({
            event: 'mutation.error',
            title: 'Action failed',
            body: errorToString(error),
            durationMs: 6000,
            data: { operation: `boards.bulk.${action}`, error: errorToString(error) },
        })
    }

    const moveToList = useMutation<void, Error, BoardListView>({
        mutationKey: ['boards', 'bulk', 'move'],
        mutationFn: async (list: BoardListView) => {
            // All N ranks up front. rankForAppend called in a loop returns the
            // SAME rank every time (it reads state that the loop never
            // updates), so every card would land on one rank and the selection
            // order would be lost to the id tiebreaker.
            const moving = cards.filter(entry => entry.list.id !== list.id)
            const ranks = ranksAfter(highestRank(list.cards), moving.length)
            await settleAll(
                moving.map((entry, index) =>
                    cardsCollection.update(entry.card.id, draft => {
                        draft.list = list.id
                        draft.position = ranks[index]
                    })
                )
            )
        },
        onSuccess: clearSelection,
        onError: bulkActionFailed('move'),
    })

    /**
     * Add or remove one label/assignee across the selection.
     *
     * `isAdding` is decided by the CALLER from the mixed state, not per card:
     * with a partial selection, one press must add to the cards that lack it
     * rather than toggle each independently — otherwise a single press would
     * both add and remove and the selection would come back inverted.
     *
     * The array is rebuilt from the DRAFT, per useToggleCardRelation: the draft
     * carries the stored value, so two rapid presses compose instead of the
     * second overwriting the first.
     */
    const setRelation = useMutation<void, Error, SetRelationInput>({
        mutationKey: ['boards', 'bulk', 'relation'],
        mutationFn: async ({ field, id, isAdding }: SetRelationInput) => {
            await settleAll(
                cards.map(entry =>
                    cardsCollection.update(entry.card.id, draft => {
                        const current = draft[field] ?? []
                        if (isAdding) {
                            if (!current.includes(id)) draft[field] = [...current, id]
                        } else {
                            draft[field] = current.filter(existing => existing !== id)
                        }
                    })
                )
            )
        },
        onSuccess: clearSelection,
        onError: bulkActionFailed('relation'),
    })

    const setPriority = useMutation<void, Error, CardPriority>({
        mutationKey: ['boards', 'bulk', 'priority'],
        mutationFn: async (priority: CardPriority) => {
            await settleAll(
                cards.map(entry =>
                    cardsCollection.update(entry.card.id, draft => {
                        draft.priority = priority
                    })
                )
            )
        },
        onSuccess: clearSelection,
        onError: bulkActionFailed('priority'),
    })

    const setEstimate = useMutation<void, Error, number>({
        mutationKey: ['boards', 'bulk', 'estimate'],
        mutationFn: async (estimate: number) => {
            await settleAll(
                cards.map(entry =>
                    cardsCollection.update(entry.card.id, draft => {
                        draft.estimate = estimate
                    })
                )
            )
        },
        onSuccess: clearSelection,
        onError: bulkActionFailed('estimate'),
    })

    const archive = useMutation<void, Error, void>({
        mutationKey: ['boards', 'bulk', 'archive'],
        mutationFn: async () => {
            await settleAll(
                cards.map(entry =>
                    cardsCollection.update(entry.card.id, draft => {
                        draft.archived = true
                    })
                )
            )
        },
        onSuccess: clearSelection,
        onError: bulkActionFailed('archive'),
    })

    return { moveToList, setRelation, setPriority, setEstimate, archive }
}
