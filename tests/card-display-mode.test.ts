import { beforeEach, describe, expect, it } from 'vitest'
import { selectCardDisplayMode, useBoardsUIStore } from '../tinycld/boards/stores/boards-ui-store'

/**
 * The mobile override, isolated from any hook harness. `selectCardDisplayMode`
 * is the ONE place a narrow screen forces the peek, so this is the test that
 * would notice a second copy of that rule appearing in a component.
 */
describe('selectCardDisplayMode', () => {
    beforeEach(() => {
        useBoardsUIStore.setState({ cardDisplayMode: 'peek' })
    })

    it('hands back the stored mode on a wide screen', () => {
        expect(selectCardDisplayMode(useBoardsUIStore.getState(), false)).toBe('peek')

        useBoardsUIStore.getState().setCardDisplayMode('modal')
        expect(selectCardDisplayMode(useBoardsUIStore.getState(), false)).toBe('modal')
    })

    it('forces the peek on mobile whatever is stored', () => {
        useBoardsUIStore.getState().setCardDisplayMode('modal')
        expect(selectCardDisplayMode(useBoardsUIStore.getState(), true)).toBe('peek')
    })

    it('leaves the stored mode alone, so a wide screen gets it back', () => {
        useBoardsUIStore.getState().setCardDisplayMode('modal')
        selectCardDisplayMode(useBoardsUIStore.getState(), true)

        // Reading on a phone must not clear the preference the desktop set.
        expect(useBoardsUIStore.getState().cardDisplayMode).toBe('modal')
        expect(selectCardDisplayMode(useBoardsUIStore.getState(), false)).toBe('modal')
    })
})
