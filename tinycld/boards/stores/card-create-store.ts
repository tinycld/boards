import { create } from '@tinycld/core/lib/store'

export interface CardCreateTarget {
    /**
     * The board the dialog creates on. The store outlives any one board
     * screen, so a dialog only opens for a target naming its own board.
     */
    projectId: string
    listId: string
    /** Computed by lib/move.ts against that column when the dialog opens. */
    position: string
    /** Pre-filled title, when the opener has one. */
    initialTitle?: string
    /** Runs once the card exists. */
    onCreated?: () => void
}

interface CardCreateState {
    target: CardCreateTarget | null
    open: (target: CardCreateTarget) => void
    close: () => void
}

/**
 * Which column the full-form dialog creates into; null while it is closed.
 *
 * A store rather than state on the board screen: the composer that opens it
 * sits inside a memoized column, and the shortcut that opens it lives in the
 * board's shortcut hook, neither of which holds a reference to the dialog.
 */
export const useCardCreateStore = create<CardCreateState>()(set => ({
    target: null,
    open: target => set({ target }),
    close: () => set({ target: null }),
}))
