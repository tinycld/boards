import { create } from '@tinycld/core/lib/store'
import type { SectionKey } from '../lib/card-sections'

const NONE: readonly SectionKey[] = []

interface SectionRevealState {
    /** Per card: the optional sections the reader opened but has not filled. */
    revealed: Record<string, readonly SectionKey[]>
    setRevealed: (cardId: string, key: SectionKey, isOpen: boolean) => void
    /** Drops a card's reveals; the card body calls it as it leaves. */
    clear: (cardId: string) => void
}

/**
 * Which optional sections the reader has opened but not yet filled.
 *
 * ONE piece of state carries both "revealed" and "its composer is open",
 * because the two begin and end together: a chip opens the section with its
 * add action already active, and closing that action un-reveals the section.
 *
 * Shared UI state between the chip row and the four sections it opens, which
 * are separate cells of the card's form. Never persisted, and cleared when the
 * card leaves the screen: a reveal that outlived the card would put an empty
 * heading back on a card nobody filled.
 */
export const useSectionRevealStore = create<SectionRevealState>()(set => ({
    revealed: {},
    setRevealed: (cardId, key, isOpen) =>
        set(state => {
            const current = state.revealed[cardId] ?? NONE
            if (current.includes(key) === isOpen) return state
            const next = isOpen ? [...current, key] : current.filter(k => k !== key)
            return { revealed: { ...state.revealed, [cardId]: next } }
        }),
    clear: cardId =>
        set(state => {
            if (!(cardId in state.revealed)) return state
            const { [cardId]: _gone, ...rest } = state.revealed
            return { revealed: rest }
        }),
}))

/** One card's reveals, and the setter for one of its sections. */
export function useSectionReveal(cardId: string, key: SectionKey) {
    const isRevealed = useSectionRevealStore(s => (s.revealed[cardId] ?? NONE).includes(key))
    const setRevealed = useSectionRevealStore(s => s.setRevealed)
    return {
        isRevealed,
        setRevealed: (isOpen: boolean) => setRevealed(cardId, key, isOpen),
    }
}

/** Every reveal on one card, for the chip row. */
export function useRevealedSections(cardId: string): ReadonlySet<SectionKey> {
    const revealed = useSectionRevealStore(s => s.revealed[cardId] ?? NONE)
    return new Set(revealed)
}
