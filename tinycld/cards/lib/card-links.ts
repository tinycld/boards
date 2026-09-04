// Card links: the vocabulary, how a directional link reads from each end, and
// the REDACTION BOUNDARY — what to render when the far card is one the reader
// is not allowed to see.
//
// Pure and outside the component, the shape lib/reactions.ts and
// lib/subtasks.ts already use, because the interesting cases here are all
// about resolution failure and none of them need React to exercise.
//
// A link is stored ONCE and read from both ends (pb-migrations/1980000016):
// `A blocks B` is the same row whether you are looking at A or at B. What
// changes is the label and which end is "the other card".

import type { BoardCardView, CardsCardLinks } from '../types'

/** The stored vocabulary — derived from the migration's select, never restated. */
export type LinkType = CardsCardLinks['type']

export const LINK_TYPES: LinkType[] = ['blocks', 'related', 'duplicates']

/**
 * How each type reads from the SOURCE end and from the TARGET end.
 *
 * `blocks` is the only directional one, and it is why the row is stored once
 * rather than mirrored: "blocked by" is not a fourth type, it is `blocks` seen
 * from the other side. The symmetric two read identically both ways, which is
 * also why server/card_links.go refuses only a reversed `blocks` as a
 * contradiction.
 */
export const LINK_LABELS: Record<LinkType, { fromSource: string; fromTarget: string }> = {
    blocks: { fromSource: 'Blocks', fromTarget: 'Blocked by' },
    related: { fromSource: 'Related to', fromTarget: 'Related to' },
    duplicates: { fromSource: 'Duplicates', fromTarget: 'Duplicated by' },
}

/** Stable ASCII names, for accessibility labels and test ids. */
export const LINK_KEYS: Record<LinkType, string> = {
    blocks: 'blocks',
    related: 'related',
    duplicates: 'duplicates',
}

export function isLinkType(raw: string): raw is LinkType {
    return (LINK_TYPES as string[]).includes(raw)
}

/**
 * The far card, as far as this reader is concerned.
 *
 * THREE outcomes, and conflating any two of them is a real bug:
 *
 *  - `resolved` — the card is in the local store. Render it fully; it opens.
 *  - `redacted` — the link row is readable but the card is not, because the
 *    reader is not on its board. PERMANENT. Render "a card on another board"
 *    and do not offer to open it.
 *  - `pending` — the card set has not finished syncing. TRANSIENT. Render
 *    nothing at all rather than a wrong answer that never corrects itself.
 *
 * The `pending` case is why this takes `isReady` rather than inferring from an
 * empty map. search-adapter.ts hit the same fork and its copy says "still
 * syncing" — exactly the wrong words for `redacted`, which will never resolve
 * however long the reader waits.
 */
export type FarCard =
    | { state: 'resolved'; card: BoardCardView }
    | { state: 'redacted' }
    | { state: 'pending' }

export function resolveFarCard(
    farCardId: string,
    cardsById: Map<string, BoardCardView>,
    isReady: boolean
): FarCard {
    const card = cardsById.get(farCardId)
    if (card) return { state: 'resolved', card }
    if (!isReady) return { state: 'pending' }
    return { state: 'redacted' }
}

/** One link, oriented for the card currently being read. */
export interface CardLinkView {
    id: string
    type: LinkType
    /** The label for THIS card's end — "Blocks" vs "Blocked by". */
    label: string
    /** The card at the other end, resolved or not. */
    far: FarCard
    /** The other card's id, which is readable even when the card is not. */
    farCardId: string
}

type LinkRow = Pick<CardsCardLinks, 'id' | 'source' | 'target' | 'type'>

/**
 * Orient every link row around one card.
 *
 * Rows arrive unfiltered by direction — the query asks for links where this
 * card is either end — so this is where "which end am I?" is decided, once,
 * instead of in the component.
 *
 * A row naming neither card is dropped rather than rendered defensively: it
 * cannot happen through the query, and inventing a third state for it would
 * add a branch nothing can reach.
 */
export function orientLinks(
    rows: LinkRow[],
    cardId: string,
    cardsById: Map<string, BoardCardView>,
    isReady: boolean
): CardLinkView[] {
    return rows.flatMap(row => {
        const isSource = row.source === cardId
        const isTarget = row.target === cardId
        if (!isSource && !isTarget) return []

        const farCardId = isSource ? row.target : row.source
        const labels = LINK_LABELS[row.type]
        return [
            {
                id: row.id,
                type: row.type,
                label: isSource ? labels.fromSource : labels.fromTarget,
                far: resolveFarCard(farCardId, cardsById, isReady),
                farCardId,
            },
        ]
    })
}

/**
 * Group oriented links under their label, in LINK_TYPES order.
 *
 * Grouped by LABEL rather than type, so "Blocks" and "Blocked by" are separate
 * sections on a card that has both — which is the whole reason the label is
 * computed per end.
 */
export function groupLinks(links: CardLinkView[]): { label: string; links: CardLinkView[] }[] {
    const order = LINK_TYPES.flatMap(type => [
        LINK_LABELS[type].fromSource,
        LINK_LABELS[type].fromTarget,
    ])
    const byLabel = new Map<string, CardLinkView[]>()
    for (const link of links) {
        const bucket = byLabel.get(link.label)
        if (bucket) bucket.push(link)
        else byLabel.set(link.label, [link])
    }
    return order.flatMap(label => {
        const bucket = byLabel.get(label)
        return bucket ? [{ label, links: bucket }] : []
    })
}

/**
 * Can `card` be offered as a link target for `subject`?
 *
 * Only self-linking is excluded here. Everything else the server refuses —
 * membership on the target board, a reversed block — depends on state the
 * picker cannot see (the far board's roster) or on rows it has not loaded, so
 * pre-filtering those would be a guess. The mutation surfaces the server's
 * refusal instead.
 */
export function canLinkTo(card: BoardCardView, subject: BoardCardView): boolean {
    return card.id !== subject.id
}
