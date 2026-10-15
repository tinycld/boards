import { beforeEach, describe, expect, it } from 'vitest'
import { useSectionRevealStore } from '../tinycld/boards/stores/section-reveal-store'

const state = () => useSectionRevealStore.getState()

describe('section reveal store', () => {
    beforeEach(() => {
        state().clear('c1')
        state().clear('c2')
    })

    it('keeps each card its own reveals', () => {
        state().setRevealed('c1', 'checklist', true)
        state().setRevealed('c2', 'links', true)
        expect(state().revealed).toEqual({ c1: ['checklist'], c2: ['links'] })
    })

    it('un-reveals a section when its composer closes', () => {
        state().setRevealed('c1', 'checklist', true)
        state().setRevealed('c1', 'links', true)
        state().setRevealed('c1', 'checklist', false)
        expect(state().revealed.c1).toEqual(['links'])
    })

    it('drops a card on clear, leaving the others', () => {
        state().setRevealed('c1', 'checklist', true)
        state().setRevealed('c2', 'links', true)
        state().clear('c1')
        expect(state().revealed).toEqual({ c2: ['links'] })
    })

    it('does not replace the state for a no-op', () => {
        state().setRevealed('c1', 'checklist', true)
        const before = state().revealed
        state().setRevealed('c1', 'checklist', true)
        expect(state().revealed).toBe(before)
    })
})
