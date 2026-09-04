import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_FILTER } from '../tinycld/cards/lib/board-filter'
import { useCardsUIStore } from '../tinycld/cards/stores/cards-ui-store'

/**
 * The view preferences (collapsed columns, card density) and what persists.
 *
 * The persistence assertions are the point: this store deliberately keeps most
 * of its state out of storage, and the two fields added here are the first
 * exceptions. A test that only exercised the toggles would not notice a
 * `partialize` that quietly started restoring the open card or the focus ring.
 */
describe('cards-ui-store view preferences', () => {
    beforeEach(() => {
        useCardsUIStore.setState({ collapsedColumnIds: {}, isCompactCards: false })
    })

    describe('toggleColumnCollapsed', () => {
        it('collapses and expands a list', () => {
            const { toggleColumnCollapsed } = useCardsUIStore.getState()

            toggleColumnCollapsed('list_a')
            expect(useCardsUIStore.getState().collapsedColumnIds.list_a).toBe(true)

            toggleColumnCollapsed('list_a')
            expect(useCardsUIStore.getState().collapsedColumnIds.list_a).toBeUndefined()
        })

        it('deletes the key on expand rather than storing false', () => {
            const { toggleColumnCollapsed } = useCardsUIStore.getState()
            toggleColumnCollapsed('list_a')
            toggleColumnCollapsed('list_a')

            // A `false` entry would make the map grow by one per list the user
            // has ever expanded, and persist that growth forever.
            expect('list_a' in useCardsUIStore.getState().collapsedColumnIds).toBe(false)
        })

        it('tracks lists independently', () => {
            const { toggleColumnCollapsed } = useCardsUIStore.getState()
            toggleColumnCollapsed('list_a')
            toggleColumnCollapsed('list_b')
            toggleColumnCollapsed('list_a')

            expect(useCardsUIStore.getState().collapsedColumnIds).toEqual({ list_b: true })
        })

        it('replaces the map rather than mutating it', () => {
            const before = useCardsUIStore.getState().collapsedColumnIds
            useCardsUIStore.getState().toggleColumnCollapsed('list_a')

            // Per-column selectors compare by identity; an in-place mutation
            // would leave subscribers reading a map that never looks changed.
            expect(useCardsUIStore.getState().collapsedColumnIds).not.toBe(before)
        })

        it('reads a list that was never collapsed as not collapsed', () => {
            // The stale-id case: a persisted id for a deleted list is inert
            // because a miss and an explicit expand are the same lookup.
            expect(!!useCardsUIStore.getState().collapsedColumnIds.gone).toBe(false)
        })
    })

    describe('toggleCompactCards', () => {
        it('flips density', () => {
            const { toggleCompactCards } = useCardsUIStore.getState()
            expect(useCardsUIStore.getState().isCompactCards).toBe(false)

            toggleCompactCards()
            expect(useCardsUIStore.getState().isCompactCards).toBe(true)

            toggleCompactCards()
            expect(useCardsUIStore.getState().isCompactCards).toBe(false)
        })
    })

    describe('toggleMyCardsShowClosed', () => {
        it('flips, and starts off', () => {
            useCardsUIStore.setState({ isMyCardsShowingClosed: false })
            useCardsUIStore.getState().toggleMyCardsShowClosed()
            expect(useCardsUIStore.getState().isMyCardsShowingClosed).toBe(true)
            useCardsUIStore.getState().toggleMyCardsShowClosed()
            expect(useCardsUIStore.getState().isMyCardsShowingClosed).toBe(false)
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
            const raw = await AsyncStorage.getItem('tinycld_cards_ui')
            expect(raw, 'nothing was persisted').toBeTruthy()
            return JSON.parse(raw as string).state
        }

        it('keeps the active board and the view preferences', async () => {
            useCardsUIStore.setState({
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
            useCardsUIStore.setState({
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
