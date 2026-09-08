import { describe, expect, it } from 'vitest'
import {
    ALL_READY,
    SECTION_KEYS,
    type SectionKey,
    visibleSections,
} from '../tinycld/boards/lib/card-sections'

/** No section has content, and none is revealed — a brand new, SETTLED card. */
function emptyState(
    has: Partial<Record<SectionKey, boolean>> = {},
    revealed: SectionKey[] = [],
    isReady: Partial<Record<SectionKey, boolean>> = {}
) {
    return {
        has: {
            attachments: false,
            checklist: false,
            subtasks: false,
            links: false,
            ...has,
        },
        isReady: { ...ALL_READY, ...isReady },
        revealed: new Set(revealed),
    }
}

describe('visibleSections', () => {
    it('hides every section on an empty card and offers all four chips', () => {
        const { visible, chips } = visibleSections(emptyState())
        expect(visible).toEqual([])
        expect(chips).toEqual(['attachments', 'checklist', 'subtasks', 'links'])
    })

    it('shows a section that has content, without offering its chip', () => {
        const { visible, chips } = visibleSections(emptyState({ checklist: true }))
        expect(visible).toEqual(['checklist'])
        expect(chips).not.toContain('checklist')
    })

    it('shows a revealed section that is still empty', () => {
        const { visible, chips } = visibleSections(emptyState({}, ['links']))
        expect(visible).toEqual(['links'])
        expect(chips).not.toContain('links')
    })

    // Rule 4: the reveal ends when the composer closes, so the section goes
    // back to hidden and its chip returns. Nothing was added, so there is
    // nothing to keep on screen.
    it('hides a section again once it is un-revealed while still empty', () => {
        const { visible, chips } = visibleSections(emptyState())
        expect(visible).not.toContain('subtasks')
        expect(chips).toContain('subtasks')
    })

    // The other half of rule 4, and the one that keeps a just-added item on
    // screen: adding through the composer gives the section content, so the
    // composer closing afterwards must not take the section down with it.
    it('keeps a section visible when it has content but is not revealed', () => {
        const { visible, chips } = visibleSections(emptyState({ subtasks: true }))
        expect(visible).toEqual(['subtasks'])
        expect(chips).not.toContain('subtasks')
    })

    // Rule 2: visibility is re-derived, never sampled. Content arriving late —
    // an on-demand query settling, or a teammate's realtime insert — opens the
    // section without anyone revealing it.
    it('shows a section whose content arrives after the card mounted', () => {
        const before = visibleSections(emptyState())
        expect(before.visible).not.toContain('checklist')

        const after = visibleSections(emptyState({ checklist: true }))
        expect(after.visible).toContain('checklist')
        expect(after.chips).not.toContain('checklist')
    })

    // Rule 3: an in-flight upload is content. The caller ORs the upload store
    // into `has.attachments` so a dropped file opens the section immediately,
    // rather than when the attachment record lands — otherwise the progress row
    // has nowhere to render.
    it('shows attachments for an upload that has no attachment record yet', () => {
        const { visible, chips } = visibleSections(emptyState({ attachments: true }))
        expect(visible).toEqual(['attachments'])
        expect(chips).not.toContain('attachments')
    })

    it('renders sections and chips in a stable order', () => {
        const { visible, chips } = visibleSections(emptyState({ links: true, attachments: true }))
        expect(visible).toEqual(['attachments', 'links'])
        expect(chips).toEqual(['checklist', 'subtasks'])
    })

    // The bug this guards, in its own words: an unsettled query reports zero
    // rows, so treating that as emptiness hid a populated section on every
    // reload and offered a chip claiming the card was bare.
    it('neither shows nor offers a section whose query has not settled', () => {
        const { visible, chips } = visibleSections(
            emptyState({}, [], { links: false, checklist: false })
        )
        expect(visible).not.toContain('links')
        expect(chips).not.toContain('links')
        expect(visible).not.toContain('checklist')
        expect(chips).not.toContain('checklist')
        // The settled ones are unaffected.
        expect(chips).toContain('attachments')
        expect(chips).toContain('subtasks')
    })

    it('offers a section as soon as its query settles empty', () => {
        const pending = visibleSections(emptyState({}, [], { links: false }))
        expect(pending.chips).not.toContain('links')

        const settled = visibleSections(emptyState())
        expect(settled.chips).toContain('links')
    })

    it('shows an unsettled section that already reports content', () => {
        const { visible, chips } = visibleSections(
            emptyState({ links: true }, [], { links: false })
        )
        expect(visible).toContain('links')
        expect(chips).not.toContain('links')
    })

    // A reveal is the reader asking for the section, not a claim about what the
    // card holds, so it does not wait on the query.
    it('shows a revealed section even while its query is in flight', () => {
        const { visible, chips } = visibleSections(
            emptyState({}, ['checklist'], { checklist: false })
        )
        expect(visible).toContain('checklist')
        expect(chips).not.toContain('checklist')
    })

    // The invariant that makes hiding safe at all: a SETTLED section is either
    // on screen or reachable from a chip, never neither. CardDetail.tsx
    // reverted an earlier hide-when-empty for exactly this reason.
    it('places every settled section in exactly one of the two lists', () => {
        const states = [
            emptyState(),
            emptyState({ checklist: true }),
            emptyState({}, ['links']),
            emptyState({ attachments: true, subtasks: true }, ['checklist', 'links']),
        ]
        for (const state of states) {
            const { visible, chips } = visibleSections(state)
            expect([...visible, ...chips].sort()).toEqual([...SECTION_KEYS].sort())
        }
    })
})
