// What happens to a card's labels when it changes boards.
//
// Labels are board-scoped rows, so a card cannot carry its label ids to
// another board. The SERVER is authoritative (endpoints_move_card.go remaps
// by name inside the transaction); this twin exists so the move dialog can
// tell the user what will be kept and what will be dropped BEFORE they
// confirm, and it must reach the same answer the server does: a
// case-insensitive, whitespace-trimmed name match.

import type { BoardLabel } from '../types'

export interface LabelRemap {
    /** The target board's labels the card will carry after the move. */
    kept: BoardLabel[]
    /** The card's labels with no namesake on the target. */
    dropped: BoardLabel[]
}

export function remapLabels(cardLabels: BoardLabel[], targetLabels: BoardLabel[]): LabelRemap {
    const byName = new Map(targetLabels.map(label => [normalize(label.name), label]))
    const kept: BoardLabel[] = []
    const dropped: BoardLabel[] = []
    for (const label of cardLabels) {
        const match = byName.get(normalize(label.name))
        if (match) kept.push(match)
        else dropped.push(label)
    }
    return { kept, dropped }
}

function normalize(name: string): string {
    return name.trim().toLowerCase()
}
