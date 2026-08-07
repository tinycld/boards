import { asyncStorage, create, persist } from '@tinycld/core/lib/store'

interface CardsUIState {
    activeProjectId: string | null
    setActiveProject: (projectId: string) => void
    /** Card shown in the side peek; null when the peek is closed. */
    openCardId: string | null
    openCard: (cardId: string) => void
    closeCard: () => void
    /**
     * The "New board" dialog. In the store rather than component state because
     * two places open it — the sidebar action and the no-boards empty state —
     * and they are in different subtrees.
     */
    isNewBoardOpen: boolean
    openNewBoard: () => void
    closeNewBoard: () => void
    /**
     * True while a card drag is live. Read imperatively via `.getState()` in
     * BoardCard's onPress: on web with movement-based activation, releasing a
     * drag can still synthesize a trailing click on the card under the
     * pointer, which would pop the peek open the instant a drop lands.
     */
    isCardDragging: boolean
    setCardDragging: (isDragging: boolean) => void
    /**
     * The keyboard focus ring. Exactly one of the two is set — a card carries
     * its own column, and an empty column can still hold focus so "new card
     * here" has a target. The card's column is deliberately NOT stored beside
     * it: a realtime move would change the card's list without changing a
     * stored column id, and the two would drift.
     *
     * Read per-card (`s => s.focusedCardId === card.id`) so only the card whose
     * ring actually flipped re-renders — a whole-board read would re-render
     * every column on every arrow press and undo the structural sharing that
     * keeps drags stable.
     */
    focusedCardId: string | null
    focusedColumnId: string | null
    focusCard: (cardId: string | null) => void
    focusColumn: (columnId: string | null) => void
}

export const useCardsUIStore = create<CardsUIState>()(
    persist(
        set => ({
            activeProjectId: null,
            // Switching boards closes the peek: the open card belongs to the
            // board being left, so it would resolve to nothing and the peek
            // would silently empty itself.
            setActiveProject: projectId => set({ activeProjectId: projectId, openCardId: null }),
            openCardId: null,
            openCard: cardId => set({ openCardId: cardId }),
            closeCard: () => set({ openCardId: null }),
            isNewBoardOpen: false,
            openNewBoard: () => set({ isNewBoardOpen: true }),
            closeNewBoard: () => set({ isNewBoardOpen: false }),
            isCardDragging: false,
            setCardDragging: isDragging => set({ isCardDragging: isDragging }),
            focusedCardId: null,
            focusedColumnId: null,
            focusCard: cardId => set({ focusedCardId: cardId, focusedColumnId: null }),
            focusColumn: columnId => set({ focusedCardId: null, focusedColumnId: columnId }),
        }),
        {
            name: 'tinycld_cards_ui',
            storage: asyncStorage,
            // Only the active board persists. A restored openCardId would
            // reopen a peek on a card that may have been deleted since, a
            // restored dialog flag would greet the user with a modal they did
            // not ask for, and a restored focus ring would point at a card that
            // may have moved or gone. A persisted id that no longer resolves is
            // handled in useActiveBoard, which falls back to the first board.
            partialize: s => ({ activeProjectId: s.activeProjectId }),
        }
    )
)
