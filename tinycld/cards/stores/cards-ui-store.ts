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
        }),
        {
            name: 'tinycld_cards_ui',
            storage: asyncStorage,
            // Only the active board persists. A restored openCardId would
            // reopen a peek on a card that may have been deleted since, and a
            // restored dialog flag would greet the user with a modal they did
            // not ask for. A persisted id that no longer resolves is handled
            // in useActiveBoard, which falls back to the first board.
            partialize: s => ({ activeProjectId: s.activeProjectId }),
        }
    )
)
