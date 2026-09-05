import { captureException } from '@tinycld/core/lib/errors'
import { useMutation } from '@tinycld/core/lib/mutations'
import { pb, useStore } from '@tinycld/core/lib/pocketbase'
import type { BoardsCards } from '../types'

export interface MoveCardToBoardInput {
    cardId: string
    projectId: string
    listId: string
    /** rankForAppend over the target list's cards, computed by the caller. */
    position: string
    /**
     * What to do with the card's sub-tasks. Required by the server whenever the
     * card has a family — it refuses rather than guessing, because both answers
     * move work the user cannot see from the dialog.
     */
    family?: 'move' | 'unlink'
    /**
     * What to do with the card's epic, when it has one: "move" recreates the
     * epic on the target board by name and files the card under it, "unlink"
     * leaves it unfiled. Required by the server whenever the card is filed,
     * for the reason `family` is. (The dialog shipped without sending this,
     * so moving any card in an epic was refused.)
     */
    epic?: 'move' | 'unlink'
}

export interface MoveCardToBoardResult {
    card: BoardsCards
    previousKey: string
    droppedLabels: string[]
    /** Sub-tasks carried across; 0 when they were left behind. */
    movedChildren: number
    /** Sub-tasks left behind as top-level cards on the source board. */
    orphanedChildren: number
    /** Whether the card stopped being a sub-task — a parent cannot follow it. */
    clearedParent: boolean
    /** The target board's epic the card landed in, '' when unfiled. */
    movedEpic: string
    clearedEpic: boolean
    /** Whether "move" had to create the epic on the target. */
    createdEpic: boolean
    /**
     * Whether the card left a sprint. Never asked: a sprint is one board's
     * dated plan, so the card lands in the target's backlog.
     */
    clearedSprint: boolean
}

interface MovePayload {
    card: BoardsCards
    previous_key: string
    dropped_labels: string[]
    moved_children: number
    orphaned_children: number
    cleared_parent: boolean
    moved_epic: string
    cleared_epic: boolean
    created_epic: boolean
    cleared_sprint: boolean
}

/**
 * Move a card to another board through the server endpoint.
 *
 * Not a collection update: boards_cards.update pins `project`, and so does
 * every child row's rule, so the client cannot repoint any of it. The
 * endpoint rewrites the card and its children in one transaction, remaps
 * labels by name, drops assignees who are not on the target, and reissues
 * the number (endpoints_move_card.go). The returned record is written into
 * the local store straight away so the card leaves the source column now
 * rather than a realtime round-trip later — the same local write
 * useMembershipVisibilitySync makes.
 */
export function useMoveCardToBoard() {
    const [cardsCollection] = useStore('boards_cards')

    return useMutation<MoveCardToBoardResult, Error, MoveCardToBoardInput>({
        mutationKey: ['boards', 'card', 'move-to-board'],
        mutationFn: async (input: MoveCardToBoardInput) => {
            try {
                const payload = await pb.send<MovePayload>(
                    `/api/boards/cards/${input.cardId}/move`,
                    {
                        method: 'POST',
                        body: {
                            project_id: input.projectId,
                            list_id: input.listId,
                            position: input.position,
                            family: input.family ?? '',
                            epic: input.epic ?? '',
                        },
                    }
                )
                cardsCollection.utils.writeUpsert(payload.card)
                return {
                    card: payload.card,
                    previousKey: payload.previous_key,
                    droppedLabels: payload.dropped_labels ?? [],
                    movedChildren: payload.moved_children ?? 0,
                    orphanedChildren: payload.orphaned_children ?? 0,
                    clearedParent: payload.cleared_parent ?? false,
                    movedEpic: payload.moved_epic ?? '',
                    clearedEpic: payload.cleared_epic ?? false,
                    createdEpic: payload.created_epic ?? false,
                    clearedSprint: payload.cleared_sprint ?? false,
                }
            } catch (err) {
                captureException('boards.card.moveToBoard', err, { ...input })
                throw err
            }
        },
    })
}
