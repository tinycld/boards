import { asyncStorage, create, persist } from '@tinycld/core/lib/store'
import { type BoardFilter, EMPTY_FILTER } from '../lib/board-filter'
import { type BoardSort, MANUAL_SORT } from '../lib/board-sort'

interface BoardsUIState {
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
     * The cards a bulk action applies to. Kept SEPARATE from the focus ring
     * above: focus is the keyboard cursor, selection is what an action targets.
     * Collapsing the two would mean j/k could not walk through a selection
     * without changing it.
     *
     * Read PER CARD (`s => s.selectedCardIds.has(card.id)`) for exactly the
     * reason the focus ring is — a whole-set read in BoardCard would re-render
     * every column on every toggle and undo the structural sharing that keeps
     * drags stable.
     *
     * NOT persisted, and cleared on board change: a restored selection would
     * target cards that may be gone and would silently arm a bulk archive
     * against rows the user cannot see. Stale ids that survive within a session
     * (a realtime archive) are dropped at the point of use by
     * `resolveSelection`, not by an effect pruning the set.
     */
    selectedCardIds: Set<string>
    /** The anchor a shift-click extends from — the last explicitly picked card. */
    lastSelectedId: string | null
    /**
     * Native's selection mode, entered from the header's Select button.
     *
     * Native has no modifier keys, and long-press is already the card drag
     * (CARD_DRAG_ACTIVATION_MS in lib/dnd.ts, deliberately tuned so a quick
     * swipe reads as a column scroll), so a mode is the only entry that does
     * not take a gesture away from something. Always false on web, where
     * ⌘/⇧-click needs no mode.
     */
    isSelectMode: boolean
    /**
     * The card order a shift-range resolves against, published by whichever
     * view is on screen (lib/board-selection.ts's `selectionOrder`).
     *
     * In the store rather than passed to BoardCard as a prop because
     * `ColumnCards` is memoized and deliberately state-free — a new prop would
     * re-render it and destabilise Drax's measurements mid-drag. Nothing
     * SUBSCRIBES to this: the press handler reads it imperatively at click
     * time, so writing it costs no render at all.
     */
    selectionOrderIds: string[]
    setSelectionOrder: (ids: string[]) => void
    selectSingle: (cardId: string) => void
    selectToggle: (cardId: string) => void
    selectRange: (cardId: string, orderedIds: string[]) => void
    /** Select every id outright — NOT a toggle, so it is idempotent. */
    selectMany: (ids: string[]) => void
    clearSelection: () => void
    setSelectMode: (isOn: boolean) => void
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
    /**
     * Which column's card composer is open, so `n` can open one that lives
     * inside a memoized BoardColumn it has no reference to.
     *
     * A single id rather than a set: two open composers would leave the user
     * unsure which one Enter lands in, and the mouse path has always allowed
     * only one at a time. Read PER COLUMN
     * (`s => s.composerOpenListId === list.id`) for the same reason the focus
     * ring is read per card — a whole-board read would re-render every column.
     *
     * The composer still owns its own open state for the press path; this is
     * the external channel, and closing writes back through it so the two
     * cannot disagree.
     */
    composerOpenListId: string | null
    openComposer: (listId: string | null) => void
    /** The board's single "add list" composer — same idea, one instance. */
    isAddListOpen: boolean
    setAddListOpen: (isOpen: boolean) => void
    /**
     * The picker a keyboard shortcut opened on the CANVAS, where the card's
     * properties are not on screen — `d`/`l`/`a`/`p` open one against the
     * focused card. The composer arrangement above, with one addition.
     *
     * It carries the focused card's RECT, and that is not redundant with the
     * core Menu's own measurement. Menu re-measures `triggerRef` on every open
     * so a keyboard-opened menu positions itself — but a canvas picker has no
     * trigger to measure: nothing on the board is the "due date chip" of a card
     * that is not open. The rect stands in for the trigger that would have been
     * there, and Menu prefers a supplied `triggerPosition` over its own layout
     * precisely so a caller can do this.
     *
     * Measured at KEYPRESS time rather than stored per card: it is a viewport
     * rect, so a scroll or a column collapse invalidates it, and the only
     * moment it is certainly right is the moment the menu opens.
     */
    openPickerFor: CanvasPicker | null
    openCanvasPicker: (picker: CanvasPicker | null) => void
    /**
     * The archived-cards panel. In the store because its entry point (the
     * header button) and the panel itself (mounted by the screen, beside the
     * peek) are in different subtrees — the NewBoardDialog arrangement.
     */
    isArchivedPanelOpen: boolean
    openArchivedPanel: () => void
    closeArchivedPanel: () => void
    /** The sidebar's Archived section, folded by default. */
    isArchivedBoardsExpanded: boolean
    toggleArchivedBoards: () => void
    /**
     * Per-board filter and sort, keyed by project id so switching boards
     * shows the other board unfiltered and switching back restores what was
     * set. SESSION-ONLY — deliberately outside `partialize`. A persisted
     * filter is not inert when stale: the user reloads into a near-empty
     * board with no explanation of where their cards went.
     */
    boardFilters: Record<string, BoardFilter>
    boardSorts: Record<string, BoardSort>
    setBoardFilter: (projectId: string, patch: Partial<BoardFilter>) => void
    clearBoardFilter: (projectId: string) => void
    setBoardSort: (projectId: string, sort: BoardSort) => void
    isFilterPanelOpen: boolean
    setFilterPanelOpen: (isOpen: boolean) => void
    /**
     * Board, list or timeline, per board. PERSISTED: a stale board id here is
     * inert (a missing key reads as "board"), and a view is exactly the kind
     * of thing someone sets once and expects to keep.
     */
    viewModeByProject: Record<string, ViewMode>
    setViewMode: (projectId: string, mode: ViewMode) => void
    /**
     * Whether My cards lists cards in done or canceled lists. PERSISTED, and
     * off by default: it is a preference with no referent to go stale, and
     * someone who wants to see finished work there wants it every time.
     */
    isMyCardsShowingClosed: boolean
    toggleMyCardsShowClosed: () => void
}

export type ViewMode = 'board' | 'list' | 'timeline'

/** Which of the four card properties a canvas shortcut opens a picker for. */
export type CanvasPickerKind = 'due' | 'labels' | 'assignees' | 'priority'

export interface CanvasPicker {
    cardId: string
    kind: CanvasPickerKind
    /** The focused card's viewport rect — see `openPickerFor`. */
    anchor: { x: number; y: number; width: number; height: number }
}

export function selectViewMode(state: BoardsUIState, projectId: string): ViewMode {
    return state.viewModeByProject[projectId] ?? 'board'
}

/**
 * Selector helpers, so an unset board yields the SAME constant every render —
 * `??` inline in a selector would too, but naming it keeps every caller on
 * the one identity that memoization depends on.
 */
export function selectBoardFilter(state: BoardsUIState, projectId: string): BoardFilter {
    return state.boardFilters[projectId] ?? EMPTY_FILTER
}

export function selectBoardSort(state: BoardsUIState, projectId: string): BoardSort {
    return state.boardSorts[projectId] ?? MANUAL_SORT
}

export const useBoardsUIStore = create<BoardsUIState>()(
    persist(
        set => ({
            activeProjectId: null,
            // Switching boards closes the peek: the open card belongs to the
            // board being left, so it would resolve to nothing and the peek
            // would silently empty itself.
            setActiveProject: projectId =>
                set({
                    activeProjectId: projectId,
                    openCardId: null,
                    openPickerFor: null,
                    // The selection belongs to the board being left; carrying it
                    // over would aim a bulk action at cards that are no longer
                    // on screen.
                    selectedCardIds: new Set<string>(),
                    lastSelectedId: null,
                }),
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
            // Moving the ring closes an open canvas picker. Its anchor is the
            // rect of the card that WAS focused, so leaving it up would float a
            // menu beside a card the ring has moved off, still writing to the
            // card it was opened for.
            focusCard: cardId =>
                set({ focusedCardId: cardId, focusedColumnId: null, openPickerFor: null }),
            focusColumn: columnId =>
                set({ focusedCardId: null, focusedColumnId: columnId, openPickerFor: null }),
            selectedCardIds: new Set<string>(),
            lastSelectedId: null,
            isSelectMode: false,
            selectionOrderIds: [],
            setSelectionOrder: ids => set({ selectionOrderIds: ids }),
            selectSingle: cardId =>
                set({ selectedCardIds: new Set([cardId]), lastSelectedId: cardId }),
            // Re-anchors on every toggle, so a ⌘-click then ⇧-click extends
            // from the card just picked rather than from an older one.
            selectToggle: cardId =>
                set(s => {
                    const next = new Set(s.selectedCardIds)
                    if (next.has(cardId)) next.delete(cardId)
                    else next.add(cardId)
                    return { selectedCardIds: next, lastSelectedId: cardId }
                }),
            // Falls back to a single selection when there is no anchor, or when
            // either end is missing from `orderedIds` — which is what a filter
            // hiding the anchor looks like. Extending from a card the user
            // cannot see would select a run they never chose.
            selectRange: (cardId, orderedIds) =>
                set(s => {
                    const anchor = s.lastSelectedId
                    if (!anchor)
                        return { selectedCardIds: new Set([cardId]), lastSelectedId: cardId }
                    const from = orderedIds.indexOf(anchor)
                    const to = orderedIds.indexOf(cardId)
                    if (from === -1 || to === -1) {
                        return { selectedCardIds: new Set([cardId]), lastSelectedId: cardId }
                    }
                    const lo = Math.min(from, to)
                    const hi = Math.max(from, to)
                    const range = orderedIds.slice(lo, hi + 1)
                    return {
                        selectedCardIds: new Set([...s.selectedCardIds, ...range]),
                        lastSelectedId: cardId,
                    }
                }),
            // Adds rather than toggling: "select all" pressed twice must leave
            // everything selected, not invert the set. The anchor moves to the
            // last id so a following shift-click extends from the end of the
            // run, which is where the user's attention is.
            selectMany: ids =>
                set(s => ({
                    selectedCardIds: new Set([...s.selectedCardIds, ...ids]),
                    lastSelectedId: ids.at(-1) ?? s.lastSelectedId,
                })),
            clearSelection: () => set({ selectedCardIds: new Set<string>(), lastSelectedId: null }),
            // Leaving the mode drops the selection: the bar goes with it, so a
            // kept selection would be targeted by shortcuts with nothing on
            // screen saying it exists.
            setSelectMode: isOn =>
                set(
                    isOn
                        ? { isSelectMode: true }
                        : {
                              isSelectMode: false,
                              selectedCardIds: new Set<string>(),
                              lastSelectedId: null,
                          }
                ),
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
            composerOpenListId: null,
            openComposer: listId => set({ composerOpenListId: listId }),
            isAddListOpen: false,
            setAddListOpen: isOpen => set({ isAddListOpen: isOpen }),
            openPickerFor: null,
            openCanvasPicker: picker => set({ openPickerFor: picker }),
            isArchivedPanelOpen: false,
            openArchivedPanel: () => set({ isArchivedPanelOpen: true }),
            closeArchivedPanel: () => set({ isArchivedPanelOpen: false }),
            isArchivedBoardsExpanded: false,
            toggleArchivedBoards: () =>
                set(s => ({ isArchivedBoardsExpanded: !s.isArchivedBoardsExpanded })),
            boardFilters: {},
            boardSorts: {},
            // A selected card that the new filter hides is invisible but still
            // targeted — the next bulk action would hit rows the user cannot
            // see. Clearing here rather than in an effect keeps it at the one
            // moment the filter actually changes.
            setBoardFilter: (projectId, patch) =>
                set(s => ({
                    boardFilters: {
                        ...s.boardFilters,
                        [projectId]: { ...selectBoardFilter(s, projectId), ...patch },
                    },
                    selectedCardIds: new Set<string>(),
                    lastSelectedId: null,
                })),
            // Deletes the key rather than storing EMPTY_FILTER, so the selector
            // hands back the shared constant again.
            clearBoardFilter: projectId =>
                set(s => {
                    const next = { ...s.boardFilters }
                    delete next[projectId]
                    return {
                        boardFilters: next,
                        selectedCardIds: new Set<string>(),
                        lastSelectedId: null,
                    }
                }),
            setBoardSort: (projectId, sort) =>
                set(s => ({ boardSorts: { ...s.boardSorts, [projectId]: sort } })),
            isFilterPanelOpen: false,
            setFilterPanelOpen: isOpen => set({ isFilterPanelOpen: isOpen }),
            viewModeByProject: {},
            // Switching view drops the selection, the way switching board
            // does: a range picked on the canvas means something different in
            // a table sorted by due date, and cards selected in one view can
            // be off-screen in the next while still being targeted by `x`.
            setViewMode: (projectId, mode) =>
                set(s => ({
                    viewModeByProject: { ...s.viewModeByProject, [projectId]: mode },
                    selectedCardIds: new Set<string>(),
                    lastSelectedId: null,
                })),
            isMyCardsShowingClosed: false,
            toggleMyCardsShowClosed: () =>
                set(s => ({ isMyCardsShowingClosed: !s.isMyCardsShowingClosed })),
        }),
        {
            name: 'tinycld_boards_ui',
            storage: asyncStorage,
            // What persists is what the user would be annoyed to redo, and
            // what cannot mislead them if it comes back stale.
            //
            // Excluded: a restored openCardId would reopen a peek on a card
            // that may have been deleted since, a restored dialog flag would
            // greet the user with a modal they did not ask for, and a restored
            // focus ring would point at a card that may have moved or gone. A
            // persisted activeProjectId that no longer resolves is handled in
            // useActiveBoard, which falls back to the first board. The two
            // composer flags are excluded on the same grounds as the dialog:
            // a reload should not land on a focused, empty input, and the
            // archived panel and sidebar section likewise: both are things
            // someone opens to look, not settings they expect to keep. The
            // filter and sort are excluded because a stale one is NOT inert —
            // see the field comment. The selection and its mode are excluded on
            // the strongest version of that same ground: a restored selection
            // is not merely wrong, it silently arms a bulk archive against rows
            // the user cannot see.
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
                viewModeByProject: s.viewModeByProject,
                isMyCardsShowingClosed: s.isMyCardsShowingClosed,
            }),
        }
    )
)
