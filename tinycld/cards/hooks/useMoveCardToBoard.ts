import { captureException } from '@tinycld/core/lib/errors'
import { useMutation } from '@tinycld/core/lib/mutations'
import { pb, useStore } from '@tinycld/core/lib/pocketbase'
import type { CardsCards } from '../types'

export interface MoveCardToBoardInput {
    cardId: string
    projectId: string
    listId: string
    /** rankForAppend over the target list's cards, computed by the caller. */
    position: string
}

export interface MoveCardToBoardResult {
    card: CardsCards
    previousKey: string
    droppedLabels: string[]
}

interface MovePayload {
    card: CardsCards
    previous_key: string
    dropped_labels: string[]
}

/**
 * Move a card to another board through the server endpoint.
 *
 * Not a collection update: cards_cards.update pins `project`, and so does
 * every child row's rule, so the client cannot repoint any of it. The
 * endpoint rewrites the card and its children in one transaction, remaps
 * labels by name, drops assignees who are not on the target, and reissues
 * the number (endpoints_move_card.go). The returned record is written into
 * the local store straight away so the card leaves the source column now
 * rather than a realtime round-trip later — the same local write
 * useMembershipVisibilitySync makes.
 */
export function useMoveCardToBoard() {
    const [cardsCollection] = useStore('cards_cards')

    return useMutation<MoveCardToBoardResult, Error, MoveCardToBoardInput>({
        mutationKey: ['cards', 'card', 'move-to-board'],
        mutationFn: async (input: MoveCardToBoardInput) => {
            try {
                const payload = await pb.send<MovePayload>(
                    `/api/cards/cards/${input.cardId}/move`,
                    {
                        method: 'POST',
                        body: {
                            project_id: input.projectId,
                            list_id: input.listId,
                            position: input.position,
                        },
                    }
                )
                cardsCollection.utils.writeUpsert(payload.card)
                return {
                    card: payload.card,
                    previousKey: payload.previous_key,
                    droppedLabels: payload.dropped_labels ?? [],
                }
            } catch (err) {
                captureException('cards.card.moveToBoard', err, { ...input })
                throw err
            }
        },
    })
}
