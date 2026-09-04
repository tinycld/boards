import { describe, expect, it } from 'vitest'
import {
    activeFacetCount,
    type BoardFilter,
    cardMatchesFilter,
    EMPTY_FILTER,
    isFilterActive,
    ME,
    matchesKeyword,
    UNASSIGNED,
} from '../tinycld/cards/lib/board-filter'
import type { BoardCardView, BoardMember } from '../tinycld/cards/types'

const maya: BoardMember = { id: 'u1', firstName: 'Maya', lastName: 'Kim' }
const sam: BoardMember = { id: 'u2', firstName: 'Sam', lastName: 'Doe' }
const NOW = new Date(2026, 8, 3, 12)

function card(overrides: Partial<BoardCardView> = {}): BoardCardView {
    return {
        id: 'c1',
        key: 'OTTER-7',
        listId: 'l1',
        position: 'a0',
        title: 'Ship the release',
        description: '',
        due: undefined,
        dueHasTime: false,
        labels: [],
        assignees: [],
        reporter: maya,
        priority: 'none',
        created: '',
        checklistTotal: 0,
        checklistDone: 0,
        commentCount: 0,
        attachmentCount: 0,
        listCategory: 'todo',
        ...overrides,
    }
}

function filter(overrides: Partial<BoardFilter>): BoardFilter {
    return { ...EMPTY_FILTER, ...overrides }
}

const ctx = { userId: 'u1', now: NOW }
const days = (n: number) => new Date(2026, 8, 3 + n)

describe('EMPTY_FILTER', () => {
    it('matches everything and counts as inactive', () => {
        expect(cardMatchesFilter(card(), EMPTY_FILTER, ctx)).toBe(true)
        expect(isFilterActive(EMPTY_FILTER)).toBe(false)
        expect(activeFacetCount(EMPTY_FILTER)).toBe(0)
    })

    it('is frozen so a selector can hand out one identity', () => {
        expect(Object.isFrozen(EMPTY_FILTER)).toBe(true)
    })
})

describe('labels', () => {
    const bug = { id: 'l1', name: 'Bug', color: '#f00' }
    const docs = { id: 'l2', name: 'Docs', color: '#0f0' }

    it('passes a card carrying ANY selected label', () => {
        const f = filter({ labelIds: ['l1', 'l2'] })
        expect(cardMatchesFilter(card({ labels: [docs] }), f, ctx)).toBe(true)
        expect(cardMatchesFilter(card({ labels: [] }), f, ctx)).toBe(false)
        expect(cardMatchesFilter(card({ labels: [bug] }), filter({ labelIds: ['l2'] }), ctx)).toBe(
            false
        )
    })
})

describe('assignees', () => {
    it('resolves me to the current user', () => {
        const f = filter({ assigneeIds: [ME] })
        expect(cardMatchesFilter(card({ assignees: [maya] }), f, ctx)).toBe(true)
        expect(cardMatchesFilter(card({ assignees: [sam] }), f, ctx)).toBe(false)
    })

    // A visitor has no id; "me" must not quietly match an empty string.
    it('never matches me for an anonymous viewer', () => {
        expect(
            cardMatchesFilter(card({ assignees: [maya] }), filter({ assigneeIds: [ME] }), {
                userId: '',
            })
        ).toBe(false)
    })

    it('matches unassigned cards only when they have nobody', () => {
        const f = filter({ assigneeIds: [UNASSIGNED] })
        expect(cardMatchesFilter(card(), f, ctx)).toBe(true)
        expect(cardMatchesFilter(card({ assignees: [sam] }), f, ctx)).toBe(false)
    })

    it('ORs ids within the facet', () => {
        const f = filter({ assigneeIds: ['u2', UNASSIGNED] })
        expect(cardMatchesFilter(card({ assignees: [sam] }), f, ctx)).toBe(true)
        expect(cardMatchesFilter(card(), f, ctx)).toBe(true)
        expect(cardMatchesFilter(card({ assignees: [maya] }), f, ctx)).toBe(false)
    })
})

describe('reporter', () => {
    it('matches by id or me', () => {
        expect(cardMatchesFilter(card(), filter({ reporterIds: [ME] }), ctx)).toBe(true)
        expect(cardMatchesFilter(card(), filter({ reporterIds: ['u2'] }), ctx)).toBe(false)
        expect(
            cardMatchesFilter(card({ reporter: undefined }), filter({ reporterIds: [ME] }), ctx)
        ).toBe(false)
    })
})

describe('due', () => {
    it('distinguishes overdue, soon, has and none against a fixed now', () => {
        const overdue = card({ due: days(-1) })
        const soon = card({ due: days(1) })
        const later = card({ due: days(10) })
        const undated = card()

        expect(cardMatchesFilter(overdue, filter({ due: 'overdue' }), ctx)).toBe(true)
        expect(cardMatchesFilter(soon, filter({ due: 'overdue' }), ctx)).toBe(false)
        expect(cardMatchesFilter(soon, filter({ due: 'soon' }), ctx)).toBe(true)
        expect(cardMatchesFilter(later, filter({ due: 'soon' }), ctx)).toBe(false)
        expect(cardMatchesFilter(later, filter({ due: 'has' }), ctx)).toBe(true)
        expect(cardMatchesFilter(undated, filter({ due: 'has' }), ctx)).toBe(false)
        expect(cardMatchesFilter(undated, filter({ due: 'none' }), ctx)).toBe(true)
        expect(cardMatchesFilter(overdue, filter({ due: 'none' }), ctx)).toBe(false)
    })
})

describe('priority', () => {
    it('matches any selected level, including none', () => {
        const f = filter({ priorities: ['urgent', 'none'] })
        expect(cardMatchesFilter(card({ priority: 'urgent' }), f, ctx)).toBe(true)
        expect(cardMatchesFilter(card({ priority: 'none' }), f, ctx)).toBe(true)
        expect(cardMatchesFilter(card({ priority: 'low' }), f, ctx)).toBe(false)
    })
})

describe('estimate', () => {
    it('splits estimated from unestimated', () => {
        const sized = card({ estimate: 5 })
        const unsized = card()
        expect(cardMatchesFilter(sized, filter({ estimate: 'estimated' }), ctx)).toBe(true)
        expect(cardMatchesFilter(unsized, filter({ estimate: 'estimated' }), ctx)).toBe(false)
        expect(cardMatchesFilter(unsized, filter({ estimate: 'unestimated' }), ctx)).toBe(true)
        expect(cardMatchesFilter(sized, filter({ estimate: 'unestimated' }), ctx)).toBe(false)
        expect(activeFacetCount(filter({ estimate: 'estimated' }))).toBe(1)
    })
})

describe('status', () => {
    it('matches any selected list category', () => {
        const f = filter({ statuses: ['in_progress', 'done'] })
        expect(cardMatchesFilter(card({ listCategory: 'in_progress' }), f, ctx)).toBe(true)
        expect(cardMatchesFilter(card({ listCategory: 'done' }), f, ctx)).toBe(true)
        expect(cardMatchesFilter(card({ listCategory: 'todo' }), f, ctx)).toBe(false)
        expect(activeFacetCount(f)).toBe(1)
    })

    it('never counts a closed card as overdue or due soon', () => {
        const late = { due: days(-1) }
        const soon = { due: days(1) }
        for (const listCategory of ['done', 'canceled'] as const) {
            expect(
                cardMatchesFilter(card({ ...late, listCategory }), filter({ due: 'overdue' }), ctx)
            ).toBe(false)
            expect(
                cardMatchesFilter(card({ ...soon, listCategory }), filter({ due: 'soon' }), ctx)
            ).toBe(false)
            // The date itself is still there.
            expect(
                cardMatchesFilter(card({ ...late, listCategory }), filter({ due: 'has' }), ctx)
            ).toBe(true)
        }
        expect(
            cardMatchesFilter(
                card({ ...late, listCategory: 'backlog' }),
                filter({ due: 'overdue' }),
                ctx
            )
        ).toBe(true)
    })
})

describe('keyword', () => {
    it('matches the title and the key, ignoring case and outer whitespace', () => {
        expect(matchesKeyword(card(), '  SHIP ')).toBe(true)
        expect(matchesKeyword(card(), 'otter-7')).toBe(true)
        expect(matchesKeyword(card(), 'launch')).toBe(false)
    })

    it('treats a blank query as no constraint', () => {
        expect(matchesKeyword(card(), '   ')).toBe(true)
        expect(activeFacetCount(filter({ text: '   ' }))).toBe(0)
    })
})

describe('composition', () => {
    it('ANDs across facets', () => {
        const f = filter({ labelIds: ['l1'], assigneeIds: [ME] })
        const bug = { id: 'l1', name: 'Bug', color: '#f00' }
        expect(cardMatchesFilter(card({ labels: [bug], assignees: [maya] }), f, ctx)).toBe(true)
        expect(cardMatchesFilter(card({ labels: [bug] }), f, ctx)).toBe(false)
        expect(cardMatchesFilter(card({ assignees: [maya] }), f, ctx)).toBe(false)
    })

    it('counts one per constrained facet', () => {
        expect(
            activeFacetCount(
                filter({ labelIds: ['l1', 'l2'], due: 'soon', text: 'x', priorities: ['high'] })
            )
        ).toBe(4)
    })
})
