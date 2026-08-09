import { useAuth } from '@tinycld/core/lib/auth'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'

export interface CreateCardInput {
    /** The column the card is added to. */
    listId: string
    title: string
    /** Computed by lib/move.ts against that column. */
    position: string
}

export interface MoveCardInput {
    cardId: string
    /** The list the card ends up in — its current one for a reorder. */
    listId: string
    /** Computed by lib/move.ts against the TARGET column. */
    position: string
}

/**
 * The card fields a user edits directly. Every one is optional: a caller
 * changing only the title must not have to restate the description.
 *
 * `due` is an ISO date string, or '' to clear it — NOT undefined. PocketBase
 * stores an unset date as '', and `toBoardCard` maps that back to undefined for
 * the UI, so '' is the wire value that actually clears the field.
 */
export interface UpdateCardInput {
    cardId: string
    title?: string
    description?: string
    due?: string
}

/**
 * Add a card to a column.
 *
 * `project` is written explicitly even though the list already knows it: the
 * denormalized relation is what every cards_cards access rule resolves
 * membership through, so a card without it is a card the rules refuse. It is
 * passed in rather than looked up because the caller (a board column) already
 * has the board it belongs to.
 *
 * Every remaining field is set explicitly rather than left to a server default.
 * PocketBase does not fill relation or text fields on insert, and an omitted
 * `labels` arrives as undefined rather than [] — which then fails the array
 * lookup in toBoardCard.
 */
export function useCreateCard(projectId: string) {
    // Non-throwing: BoardColumn calls the mutation hooks unconditionally, so
    // they are constructed on the PUBLIC board too — where there is no
    // session and the affordances that would invoke them are already gated
    // off. Throwing here made merely RENDERING a shared board an error.
    const { user } = useAuth({ throwIfAnon: false })
    const [cardsCollection] = useStore('cards_cards')

    return useMutation<string, Error, CreateCardInput>({
        mutationKey: ['cards', 'card', 'create'],
        mutationFn: mutation(function* (input: CreateCardInput) {
            const cardId = newRecordId()

            yield cardsCollection.insert({
                id: cardId,
                project: projectId,
                list: input.listId,
                position: input.position,
                title: input.title,
                description: '',
                due: '',
                assignees: [],
                labels: [],
                created_by: user?.id ?? '',
                archived: false,
                // Counters are server-maintained (server/counters.go) and
                // recomputed on every child write; these are the at-rest values
                // for a card that has no children yet.
                checklist_total: 0,
                checklist_done: 0,
                comment_count: 0,
                attachment_count: 0,
            })

            return cardId
        }),
    })
}

/**
 * Edit a card's own fields.
 *
 * Only the keys present on the input are written. The draft mutator makes that
 * natural — an absent key is simply never assigned — which matters because
 * writing `undefined` into a PocketBase text field stores the string
 * "undefined" rather than leaving it alone.
 */
export function useUpdateCard() {
    const [cardsCollection] = useStore('cards_cards')

    return useMutation<void, Error, UpdateCardInput>({
        mutationKey: ['cards', 'card', 'update'],
        mutationFn: mutation(function* (input: UpdateCardInput) {
            yield cardsCollection.update(input.cardId, draft => {
                if (input.title !== undefined) draft.title = input.title
                if (input.description !== undefined) draft.description = input.description
                if (input.due !== undefined) draft.due = input.due
            })
        }),
    })
}

/**
 * Archive a card, or restore it.
 *
 * Archiving rather than deleting: `buildBoardProject` already skips archived
 * cards, so the card leaves the board without taking its comments, checklist
 * and attachments with it — and without a confirm dialog, because nothing is
 * destroyed. Real deletion is the card menu's separate, confirmed action.
 */
export function useArchiveCard() {
    const [cardsCollection] = useStore('cards_cards')

    return useMutation<void, Error, { cardId: string; archived: boolean }>({
        mutationKey: ['cards', 'card', 'archive'],
        mutationFn: mutation(function* ({ cardId, archived }) {
            yield cardsCollection.update(cardId, draft => {
                draft.archived = archived
            })
        }),
    })
}

/**
 * Delete a card outright.
 *
 * Cascades server-side to its checklist items, comments and attachments (all
 * relate to `card` with cascadeDelete). Callers must confirm first.
 */
export function useDeleteCard() {
    const [cardsCollection] = useStore('cards_cards')

    return useMutation<void, Error, string>({
        mutationKey: ['cards', 'card', 'delete'],
        mutationFn: mutation(function* (cardId: string) {
            yield cardsCollection.delete(cardId)
        }),
    })
}

/**
 * Add or remove one id in a card's `labels` or `assignees`.
 *
 * Both are multi-relation `string[]` columns, so there is no array operator to
 * reach for: the new array is built here and written whole. The draft carries
 * the CURRENT stored value, so toggling reads from the draft rather than from a
 * possibly-stale render — two rapid toggles then compose instead of the second
 * overwriting the first with the array the first one started from.
 */
export function useToggleCardRelation() {
    const [cardsCollection] = useStore('cards_cards')

    return useMutation<
        void,
        Error,
        { cardId: string; field: 'labels' | 'assignees'; id: string; isSelected: boolean }
    >({
        mutationKey: ['cards', 'card', 'toggle-relation'],
        mutationFn: mutation(function* ({ cardId, field, id, isSelected }) {
            yield cardsCollection.update(cardId, draft => {
                const current = draft[field] ?? []
                draft[field] = isSelected
                    ? current.filter(existing => existing !== id)
                    : [...current, id]
            })
        }),
    })
}

/**
 * Move a card to a list and a position.
 *
 * ONE ROW, ONE UPDATE. That is the whole point of the fractional ranks in
 * lib/rank.ts: siblings are never renumbered, so an optimistic move cannot
 * reorder cards the user did not touch, and two concurrent moves cannot clobber
 * each other's positions.
 *
 * `list` and `position` are written together because they are one user
 * intention — writing them separately would render the card at its old position
 * inside its new column for a frame.
 *
 * No `onError`: the default handler reports to Sentry and raises a toast keyed
 * off `mutationKey`, which is what a failed move needs. `.mutate()` never throws
 * to its caller, so without a handler somewhere a rejected move would roll the
 * optimistic update back silently.
 */
export function useMoveCard() {
    const [cardsCollection] = useStore('cards_cards')

    return useMutation<void, Error, MoveCardInput>({
        mutationKey: ['cards', 'card', 'move'],
        mutationFn: mutation(function* (input: MoveCardInput) {
            yield cardsCollection.update(input.cardId, draft => {
                draft.list = input.listId
                draft.position = input.position
            })
        }),
    })
}
