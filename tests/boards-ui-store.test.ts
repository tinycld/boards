import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_FILTER } from '../tinycld/boards/lib/board-filter'
import { useBoardsUIStore } from '../tinycld/boards/stores/boards-ui-store'

/**
 * The view preferences (collapsed columns, card density) and what persists.
 *
 * The persistence assertions are the point: this store deliberately keeps most
 * of its state out of storage, and the two fields added here are the first
 * exceptions. A test that only exercised the toggles would not notice a
 * `partialize` that quietly started restoring the open card or the focus ring.
 */
describe('boards-ui-store view preferences', () => {
    beforeEach(() => {
        useBoardsUIStore.setState({ collapsedColumnIds: {}, isCompactCards: false })
    })

    describe('toggleColumnCollapsed', () => {
        it('collapses and expands a list', () => {
            const { toggleColumnCollapsed } = useBoardsUIStore.getState()

            toggleColumnCollapsed('list_a')
            expect(useBoardsUIStore.getState().collapsedColumnIds.list_a).toBe(true)

            toggleColumnCollapsed('list_a')
            expect(useBoardsUIStore.getState().collapsedColumnIds.list_a).toBeUndefined()
        })

        it('deletes the key on expand rather than storing false', () => {
            const { toggleColumnCollapsed } = useBoardsUIStore.getState()
            toggleColumnCollapsed('list_a')
            toggleColumnCollapsed('list_a')

            // A `false` entry would make the map grow by one per list the user
            // has ever expanded, and persist that growth forever.
            expect('list_a' in useBoardsUIStore.getState().collapsedColumnIds).toBe(false)
        })

        it('tracks lists independently', () => {
            const { toggleColumnCollapsed } = useBoardsUIStore.getState()
            toggleColumnCollapsed('list_a')
            toggleColumnCollapsed('list_b')
            toggleColumnCollapsed('list_a')

            expect(useBoardsUIStore.getState().collapsedColumnIds).toEqual({ list_b: true })
        })

        it('replaces the map rather than mutating it', () => {
            const before = useBoardsUIStore.getState().collapsedColumnIds
            useBoardsUIStore.getState().toggleColumnCollapsed('list_a')

            // Per-column selectors compare by identity; an in-place mutation
            // would leave subscribers reading a map that never looks changed.
            expect(useBoardsUIStore.getState().collapsedColumnIds).not.toBe(before)
        })

        it('reads a list that was never collapsed as not collapsed', () => {
            // The stale-id case: a persisted id for a deleted list is inert
            // because a miss and an explicit expand are the same lookup.
            expect(!!useBoardsUIStore.getState().collapsedColumnIds.gone).toBe(false)
        })
    })

    describe('toggleCompactCards', () => {
        it('flips density', () => {
            const { toggleCompactCards } = useBoardsUIStore.getState()
            expect(useBoardsUIStore.getState().isCompactCards).toBe(false)

            toggleCompactCards()
            expect(useBoardsUIStore.getState().isCompactCards).toBe(true)

            toggleCompactCards()
            expect(useBoardsUIStore.getState().isCompactCards).toBe(false)
        })
    })

    describe('toggleMyCardsShowClosed', () => {
        it('flips, and starts off', () => {
            useBoardsUIStore.setState({ isMyCardsShowingClosed: false })
            useBoardsUIStore.getState().toggleMyCardsShowClosed()
            expect(useBoardsUIStore.getState().isMyCardsShowingClosed).toBe(true)
            useBoardsUIStore.getState().toggleMyCardsShowClosed()
            expect(useBoardsUIStore.getState().isMyCardsShowingClosed).toBe(false)
        })
    })

    describe('openCanvasPicker', () => {
        const anchor = { x: 10, y: 20, width: 200, height: 60 }

        beforeEach(() => {
            useBoardsUIStore.setState({ openPickerFor: null, focusedCardId: null })
        })

        it('holds the card, the kind and the anchor rect', () => {
            useBoardsUIStore.getState().openCanvasPicker({ cardId: 'card_1', kind: 'due', anchor })

            expect(useBoardsUIStore.getState().openPickerFor).toEqual({
                cardId: 'card_1',
                kind: 'due',
                anchor,
            })
        })

        // The anchor is the rect of the card that WAS focused, so a picker left
        // open across a move would float beside one card while writing to
        // another. Both focus setters clear it for that reason.
        it('closes when the focus ring moves to another card', () => {
            const store = useBoardsUIStore.getState()
            store.openCanvasPicker({ cardId: 'card_1', kind: 'labels', anchor })

            store.focusCard('card_2')

            expect(useBoardsUIStore.getState().openPickerFor).toBeNull()
        })

        it('closes when focus moves to a column', () => {
            const store = useBoardsUIStore.getState()
            store.openCanvasPicker({ cardId: 'card_1', kind: 'assignees', anchor })

            store.focusColumn('list_1')

            expect(useBoardsUIStore.getState().openPickerFor).toBeNull()
        })

        // The card and the rect both belong to the board being left.
        it('closes on a board switch', () => {
            const store = useBoardsUIStore.getState()
            store.openCanvasPicker({ cardId: 'card_1', kind: 'priority', anchor })

            store.setActiveProject('proj_2')

            expect(useBoardsUIStore.getState().openPickerFor).toBeNull()
        })
    })

    describe('persistence', () => {
        /**
         * Reads what the persist middleware ACTUALLY wrote, rather than
         * restating `partialize` here. A copy of the rule in the test cannot
         * fail for the reason it was written — the same trap the package's Go
         * rule suites exist to avoid.
         */
        async function persisted(): Promise<Record<string, unknown>> {
            const raw = await AsyncStorage.getItem('tinycld_boards_ui')
            expect(raw, 'nothing was persisted').toBeTruthy()
            return JSON.parse(raw as string).state
        }

        it('keeps the active board and the view preferences', async () => {
            useBoardsUIStore.setState({
                activeProjectId: 'proj_1',
                collapsedColumnIds: { list_a: true },
                isCompactCards: true,
                viewModeByProject: { proj_1: 'list' },
                isMyCardsShowingClosed: true,
            })

            expect(await persisted()).toEqual({
                activeProjectId: 'proj_1',
                collapsedColumnIds: { list_a: true },
                isCompactCards: true,
                viewModeByProject: { proj_1: 'list' },
                isMyCardsShowingClosed: true,
            })
        })

        it('never persists the open card, the dialog flag, or the focus ring', async () => {
            useBoardsUIStore.setState({
                activeProjectId: 'proj_1',
                openCardId: 'card_1',
                isNewBoardOpen: true,
                focusedCardId: 'card_2',
                isCardDragging: true,
                isArchivedPanelOpen: true,
                isArchivedBoardsExpanded: true,
                boardFilters: { proj_1: { ...EMPTY_FILTER, text: 'stale' } },
                boardSorts: { proj_1: { field: 'due', direction: 'asc' } },
                isFilterPanelOpen: true,
            })

            // Restoring any of these greets the user with a peek on a possibly
            // deleted card, an unrequested modal, or a ring pointing at a card
            // that has since moved — and a restored filter is worse still: a
            // near-empty board with no explanation of where the cards went.
            expect(Object.keys(await persisted()).sort()).toEqual([
                'activeProjectId',
                'collapsedColumnIds',
                'isCompactCards',
                'isMyCardsShowingClosed',
                'viewModeByProject',
            ])
        })
    })
})
