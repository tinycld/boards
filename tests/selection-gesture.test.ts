import { describe, expect, it } from 'vitest'
import { clickAction } from '../tinycld/boards/lib/selection-gesture'

const NONE = { meta: false, ctrl: false, shift: false }
const META = { meta: true, ctrl: false, shift: false }
const CTRL = { meta: false, ctrl: true, shift: false }
const SHIFT = { meta: false, ctrl: false, shift: true }

describe('clickAction', () => {
    it('opens the card on a plain click with nothing selected', () => {
        expect(clickAction(NONE, new Set())).toEqual({ type: 'open' })
    })

    // The selection is the mode: once one exists, a plain click re-aims it
    // rather than opening a card. Opening instead would make it impossible to
    // narrow a selection without first clearing it.
    it('collapses to one card on a plain click while a selection stands', () => {
        expect(clickAction(NONE, new Set(['a', 'b']))).toEqual({ type: 'single' })
        expect(clickAction(NONE, new Set(['a']))).toEqual({ type: 'single' })
    })

    it('toggles on meta or ctrl, on both platforms', () => {
        expect(clickAction(META, new Set())).toEqual({ type: 'toggle' })
        expect(clickAction(CTRL, new Set(['a']))).toEqual({ type: 'toggle' })
    })

    it('extends a range on shift', () => {
        expect(clickAction(SHIFT, new Set(['a']))).toEqual({ type: 'range' })
    })

    // A modified click must never fall through to the plain-click branches:
    // that is the drive CI failure this module's header records, where a
    // ctrl-click read as a plain one and REPLACED the selection.
    it('never opens or collapses when a modifier is held', () => {
        for (const modifiers of [META, CTRL, SHIFT]) {
            for (const selected of [new Set<string>(), new Set(['a', 'b'])]) {
                const action = clickAction(modifiers, selected)
                expect(action.type).not.toBe('open')
                expect(action.type).not.toBe('single')
            }
        }
    })

    // meta wins arbitrarily but deterministically — asserted so the precedence
    // is a decision rather than an accident of branch order.
    it('prefers toggle over range when both modifiers are held', () => {
        expect(clickAction({ meta: true, ctrl: false, shift: true }, new Set())).toEqual({
            type: 'toggle',
        })
    })
})
