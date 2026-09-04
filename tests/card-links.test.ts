import { describe, expect, it } from 'vitest'
import {
    canLinkTo,
    groupLinks,
    isLinkType,
    LINK_LABELS,
    type LINK_TYPES,
    orientLinks,
    resolveFarCard,
} from '../tinycld/cards/lib/card-links'
import type { BoardCardView } from '../tinycld/cards/types'

function card(id: string, overrides: Partial<BoardCardView> = {}): BoardCardView {
    return {
        id,
        key: `OTTER-${id.replace(/\D/g, '') || '1'}`,
        listId: 'l1',
        position: 'a0',
        title: id,
        description: '',
        dueHasTime: false,
        labels: [],
        assignees: [],
        priority: 'none',
        listCategory: 'todo',
        created: '',
        checklistTotal: 0,
        checklistDone: 0,
        commentCount: 0,
        attachmentCount: 0,
        parent: '',
        parentKey: '',
        subtaskTotal: 0,
        subtaskDone: 0,
        ...overrides,
    }
}

function row(id: string, source: string, target: string, type = 'blocks') {
    return { id, source, target, type } as {
        id: string
        source: string
        target: string
        type: (typeof LINK_TYPES)[number]
    }
}

const store = (...cards: BoardCardView[]) => new Map(cards.map(c => [c.id, c]))

describe('the vocabulary', () => {
    it('accepts only the stored types', () => {
        expect(isLinkType('blocks')).toBe(true)
        expect(isLinkType('related')).toBe(true)
        expect(isLinkType('duplicates')).toBe(true)
        expect(isLinkType('blocked_by')).toBe(false)
    })

    // "Blocked by" is not a fourth type — it is `blocks` read from the other
    // end, which is why the row is stored once instead of mirrored.
    it('reads blocks differently from each end, and the symmetric ones alike', () => {
        expect(LINK_LABELS.blocks.fromSource).toBe('Blocks')
        expect(LINK_LABELS.blocks.fromTarget).toBe('Blocked by')
        expect(LINK_LABELS.related.fromSource).toBe(LINK_LABELS.related.fromTarget)
    })
})

describe('resolveFarCard', () => {
    it('resolves a card that is loaded', () => {
        const far = card('c2')
        expect(resolveFarCard('c2', store(far), true)).toEqual({ state: 'resolved', card: far })
    })

    // The distinction the whole feature's honesty rests on: an absent card is
    // only "redacted" once we know it is not merely late.
    it('is pending while the card set is unsettled', () => {
        expect(resolveFarCard('c2', store(), false)).toEqual({ state: 'pending' })
    })

    it('is redacted once the card set has settled without it', () => {
        expect(resolveFarCard('c2', store(), true)).toEqual({ state: 'redacted' })
    })
})

describe('orientLinks', () => {
    it('labels a link from the source end', () => {
        const links = orientLinks([row('l1', 'c1', 'c2')], 'c1', store(card('c2')), true)
        expect(links[0]?.label).toBe('Blocks')
        expect(links[0]?.farCardId).toBe('c2')
    })

    it('labels the SAME row from the target end', () => {
        const links = orientLinks([row('l1', 'c1', 'c2')], 'c2', store(card('c1')), true)
        expect(links[0]?.label).toBe('Blocked by')
        expect(links[0]?.farCardId).toBe('c1')
    })

    // The far card's id is known even when the card is not — that is exactly
    // what the server hands over, and what the redacted row renders from.
    it('keeps the far id when the far card is redacted', () => {
        const links = orientLinks([row('l1', 'c1', 'c2')], 'c1', store(), true)
        expect(links[0]?.far).toEqual({ state: 'redacted' })
        expect(links[0]?.farCardId).toBe('c2')
    })

    it('drops a row naming neither card', () => {
        expect(orientLinks([row('l1', 'cX', 'cY')], 'c1', store(), true)).toEqual([])
    })
})

describe('groupLinks', () => {
    // Grouped by LABEL, not type: a card that both blocks and is blocked by
    // something needs those as separate sections.
    it('separates the two ends of blocks', () => {
        const links = orientLinks(
            [row('l1', 'c1', 'c2'), row('l2', 'c3', 'c1')],
            'c1',
            store(card('c2'), card('c3')),
            true
        )
        expect(groupLinks(links).map(g => g.label)).toEqual(['Blocks', 'Blocked by'])
    })

    it('collects several links under one label', () => {
        const links = orientLinks(
            [row('l1', 'c1', 'c2'), row('l2', 'c1', 'c3')],
            'c1',
            store(card('c2'), card('c3')),
            true
        )
        const groups = groupLinks(links)
        expect(groups).toHaveLength(1)
        expect(groups[0]?.links).toHaveLength(2)
    })

    it('is empty for a card with no links', () => {
        expect(groupLinks([])).toEqual([])
    })
})

describe('canLinkTo', () => {
    it('refuses the card itself', () => {
        const subject = card('c1')
        expect(canLinkTo(subject, subject)).toBe(false)
    })

    // Everything else the server refuses depends on state the picker cannot
    // see, so it is deliberately NOT pre-filtered here.
    it('accepts any other card', () => {
        expect(canLinkTo(card('c2'), card('c1'))).toBe(true)
        expect(canLinkTo(card('c3', { parent: 'c9' }), card('c1'))).toBe(true)
    })
})
