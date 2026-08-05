import { create } from '@tinycld/core/lib/store'

interface CardsUIState {
    activeProjectId: string | null
    setActiveProject: (projectId: string) => void
    /** Card shown in the side peek; null when the peek is closed. */
    openCardId: string | null
    openCard: (cardId: string) => void
    closeCard: () => void
    /**
     * Card moves made through the detail stepper, cardId → target listId.
     * Session-only overlay on the static sample data; becomes a real
     * mutation once cards live in PocketBase.
     */
    cardMoves: Record<string, string>
    moveCard: (cardId: string, listId: string) => void
}

export const useCardsUIStore = create<CardsUIState>()(set => ({
    activeProjectId: null,
    setActiveProject: projectId => set({ activeProjectId: projectId, openCardId: null }),
    openCardId: null,
    openCard: cardId => set({ openCardId: cardId }),
    closeCard: () => set({ openCardId: null }),
    cardMoves: {},
    moveCard: (cardId, listId) =>
        set(state => ({ cardMoves: { ...state.cardMoves, [cardId]: listId } })),
}))
