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
    /**
     * Lists the user has collapsed to a narrow spine. A set rather than a flag
     * on the list: collapse is a per-USER view preference with no row to derive
     * it from, and putting it on BoardListView would mean a new comparison in
     * buildBoardProject's structural sharing — where a missed field silently
     * keeps reusing the stale node.
     *
     * Keyed by list id, which is globally unique, so one map serves every
     * board. Read per-column (`s => !!s.collapsedColumnIds[list.id]`) for the
     * same reason the focus ring is read per-card: a whole-map read would
     * re-render every column on every toggle.
     */
    collapsedColumnIds: Record<string, true>
    toggleColumnCollapsed: (listId: string) => void
    /**
     * Card density, board-wide. Off = the full face; on = one line plus
     * assignees and due state.
     */
    isCompactCards: boolean
    toggleCompactCards: () => void
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
            collapsedColumnIds: {},
            // Deletes rather than storing `false`, so the map holds only
            // collapsed ids and never accumulates an entry per list the user
            // has ever expanded.
            toggleColumnCollapsed: listId =>
                set(s => {
                    const next = { ...s.collapsedColumnIds }
                    if (next[listId]) delete next[listId]
                    else next[listId] = true
                    return { collapsedColumnIds: next }
                }),
            isCompactCards: false,
            toggleCompactCards: () => set(s => ({ isCompactCards: !s.isCompactCards })),
        }),
        {
            name: 'tinycld_cards_ui',
            storage: asyncStorage,
            // What persists is what the user would be annoyed to redo, and
            // what cannot mislead them if it comes back stale.
            //
            // Excluded: a restored openCardId would reopen a peek on a card
            // that may have been deleted since, a restored dialog flag would
            // greet the user with a modal they did not ask for, and a restored
            // focus ring would point at a card that may have moved or gone. A
            // persisted activeProjectId that no longer resolves is handled in
            // useActiveBoard, which falls back to the first board.
            //
            // The two view preferences persist because a stale value of either
            // is INERT rather than wrong: a collapsed id naming a list that no
            // longer exists is simply never looked up (a miss reads as "not
            // collapsed"), and density is a preference with no referent to go
            // stale at all. Both are also exactly the kind of thing someone
            // sets once and expects to survive a reload.
            partialize: s => ({
                activeProjectId: s.activeProjectId,
                collapsedColumnIds: s.collapsedColumnIds,
                isCompactCards: s.isCompactCards,
            }),
        }
    )
)
