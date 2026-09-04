// Imported from the module rather than the package index: the index also
// exports `useRichEditor`, whose platform split has no resolvable file under
// vitest.
import {
    filterTriggerItems,
    renderInsertTemplate,
    type TriggerItem,
} from '@tinycld/core/lib/editor/rich/triggers'
import { describe, expect, it } from 'vitest'
import { mentionedUserIds, renderMentionTokens } from '~/tinycld/boards/lib/mention-text'

// The mention trigger's CONFIG is declarative — `allItems` + an
// `insertTemplate` — so what it inserts can be asserted without mounting the
// hook, an editor, or a WebView. That matters more than usual here: the native
// picker cannot be reached by boards' e2e suite, which runs on web, so these
// assertions are what stand behind the token format on a phone.

/** The template useMentionTrigger ships. Kept verbatim, trailing space and all. */
const INSERT_TEMPLATE = '[[@{id}]] '

const MEMBERS: TriggerItem[] = [
    { id: 'ada000000000001', label: 'Ada Lovelace', secondary: 'ada@example.com' },
    { id: 'grc000000000002', label: 'Grace Hopper', secondary: 'grace@navy.mil' },
]

describe('the mention insert template', () => {
    it('produces the token both parsers read', () => {
        expect(renderInsertTemplate(INSERT_TEMPLATE, MEMBERS[0])).toBe('[[@ada000000000001]] ')
    })

    it('keeps the trailing space, so typing continues outside the token', () => {
        expect(renderInsertTemplate(INSERT_TEMPLATE, MEMBERS[0]).endsWith(']] ')).toBe(true)
    })

    it('round-trips: what the picker inserts is what mentionedUserIds finds', () => {
        // The seam that actually matters. The insert side lives in core and the
        // parse side in cards, so nothing but a test holds them together.
        const body = `please review ${renderInsertTemplate(INSERT_TEMPLATE, MEMBERS[1])}thanks`
        expect(mentionedUserIds(body)).toEqual(['grc000000000002'])
    })

    it('round-trips through the RENDERER as the member’s name', () => {
        const body = renderInsertTemplate(INSERT_TEMPLATE, MEMBERS[0])
        const rendered = renderMentionTokens(body, [
            { userId: MEMBERS[0].id, label: 'Ada Lovelace' },
        ])
        expect(rendered.trim()).toBe('@Ada Lovelace')
        expect(rendered).not.toContain(MEMBERS[0].id)
    })
})

describe('the candidate filter', () => {
    // Boards used to own this filter inline; it moved to core so the web hook
    // and the in-WebView page cannot rank differently. These pin the behaviour
    // boards depends on.
    it('finds someone by the start of their name', () => {
        expect(filterTriggerItems(MEMBERS, 'ada', 6).map(m => m.id)).toEqual(['ada000000000001'])
    })

    it('finds someone by their email, which is how duplicates get told apart', () => {
        expect(filterTriggerItems(MEMBERS, 'navy', 6).map(m => m.id)).toEqual(['grc000000000002'])
    })

    it('offers everyone for a bare `@`', () => {
        expect(filterTriggerItems(MEMBERS, '', 6)).toHaveLength(2)
    })

    it('offers nobody rather than everybody when nothing matches', () => {
        expect(filterTriggerItems(MEMBERS, 'zzz', 6)).toEqual([])
    })
})
