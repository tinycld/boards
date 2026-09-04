// Sub-tasks: which cards may parent which, and how a family reads.
//
// Pure and outside the component so the edge cases below can be tested without
// React — the reason lib/comment-threads.ts exists in the same shape, and
// several of these cases are the same ones, because `parent` is a plain
// relation with no integrity guarantee beyond naming some cards_cards row.
//
// The rules this module encodes are enforced for real on the server: the
// same-board pin lives in migration 1980000015, and the cycle/depth guard in
// server/card_parent.go. What is here keeps the UI from OFFERING a choice that
// the server would refuse — a picker that lists an option which 400s is worse
// than one that never lists it.

import type { BoardCardView } from '../types'

/**
 * Can `card` be offered as a parent for `subject`?
 *
 * Two exclusions, each mirroring a server refusal:
 *
 *  - ITSELF. A card is not its own sub-task.
 *  - A CARD THAT IS ALREADY A SUB-TASK. Accepting would build a three-level
 *    tree, which server/card_parent.go's depth check refuses.
 *
 * The depth check subsumes the cycle case rather than leaving it to a separate
 * clause: a child of `subject` is by definition a card with a parent, so it is
 * already excluded. That equivalence holds only while depth is capped at one
 * level — if the cap is ever raised, this needs a real ancestor walk, the one
 * server/card_parent.go does.
 *
 * Same-board is NOT tested here, and deliberately: every caller passes the
 * open board's own cards, so an off-board card is never in the candidate set.
 * Archived cards are likewise filtered out of the board before they reach
 * here.
 */
export function canBeParentOf(card: BoardCardView, subject: BoardCardView): boolean {
    if (card.id === subject.id) return false
    if (card.parent !== '') return false
    return true
}

/** The cards that may parent `subject`, in board order. */
export function parentCandidates(cards: BoardCardView[], subject: BoardCardView): BoardCardView[] {
    return cards.filter(card => canBeParentOf(card, subject))
}

/** The direct sub-tasks of `card`, in the order they were given. */
export function childrenOf(cards: BoardCardView[], card: BoardCardView): BoardCardView[] {
    return cards.filter(child => child.parent === card.id)
}

/**
 * The parent of `card`, or undefined when it is top level.
 *
 * A dangling id — the parent was deleted, and `parent` deliberately does not
 * cascade — resolves to undefined, so the card reads as top level rather than
 * rendering a chip pointing at nothing. lib/comment-threads.ts promotes an
 * orphaned reply for the same reason.
 */
export function parentOf(cards: BoardCardView[], card: BoardCardView): BoardCardView | undefined {
    if (!card.parent) return undefined
    return cards.find(candidate => candidate.id === card.parent)
}

/** Whether a card's face should show the rollup at all. */
export function hasSubtasks(card: Pick<BoardCardView, 'subtaskTotal'>): boolean {
    return card.subtaskTotal > 0
}

/**
 * "2/5" for the face, and for the detail section's header.
 *
 * The counters come off the card row (server/card_parent.go), not from
 * counting the loaded children, so this reads the same on My cards and in
 * search results — where the children are not loaded at all.
 */
export function formatSubtaskRollup(
    card: Pick<BoardCardView, 'subtaskTotal' | 'subtaskDone'>
): string {
    return `${card.subtaskDone}/${card.subtaskTotal}`
}

/** Whether every sub-task is closed. Drives the face's completion tint. */
export function subtasksComplete(
    card: Pick<BoardCardView, 'subtaskTotal' | 'subtaskDone'>
): boolean {
    return card.subtaskTotal > 0 && card.subtaskDone === card.subtaskTotal
}
