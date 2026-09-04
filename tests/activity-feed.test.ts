import { describe, expect, it } from 'vitest'
import { buildActivityFeed, describeActivity } from '../tinycld/boards/lib/activity-feed'
import { buildCommentThreads } from '../tinycld/boards/lib/comment-threads'
import type { BoardActivity, BoardComment, BoardMember } from '../tinycld/boards/types'

const maya: BoardMember = { id: 'u1', firstName: 'Maya', lastName: 'Kim' }

function comment(id: string, created: string, parent = ''): BoardComment {
    return { id, author: maya, created, editedAt: '', body: id, parent }
}

function activity(
    id: string,
    kind: BoardActivity['kind'],
    created: string,
    overrides: Partial<BoardActivity> = {}
): BoardActivity {
    return { id, kind, created, actor: maya, from: '', to: '', ...overrides }
}

const ctx = {
    lists: [
        { id: 'l1', name: 'To do' },
        { id: 'l2', name: 'Doing' },
    ],
    labels: [{ id: 'lb1', name: 'Bug', color: '#f00' }],
    members: [maya, { id: 'u2', firstName: 'Sam', lastName: 'Doe' }],
    cards: [
        { id: 'cd1', key: 'OTTER-4', title: 'Ship auth' },
        // A board with no slug has no keys, so the title is the fallback.
        { id: 'cd2', key: '', title: 'Untitled epic' },
    ],
}

describe('buildActivityFeed', () => {
    it('interleaves threads and history by time, oldest first', () => {
        const threads = buildCommentThreads([
            comment('c1', '2026-01-02 00:00:00.000Z'),
            comment('r1', '2026-01-05 00:00:00.000Z', 'c1'),
        ])
        const feed = buildActivityFeed(threads, [
            activity('a1', 'created', '2026-01-01 00:00:00.000Z'),
            activity('a2', 'moved', '2026-01-03 00:00:00.000Z'),
        ])
        expect(feed.map(e => e.id)).toEqual(['a1', 'c1', 'a2'])
    })

    // A reply belongs to its thread wherever it lands in time — the root's
    // timestamp orders the whole thread.
    it('keeps a late reply under its parent', () => {
        const threads = buildCommentThreads([
            comment('c1', '2026-01-01 00:00:00.000Z'),
            comment('r1', '2026-01-09 00:00:00.000Z', 'c1'),
        ])
        const feed = buildActivityFeed(threads, [activity('a1', 'due', '2026-01-05 00:00:00.000Z')])
        expect(feed.map(e => e.id)).toEqual(['c1', 'a1'])
        expect(feed[0]?.kind === 'thread' && feed[0].thread.replies.map(r => r.id)).toEqual(['r1'])
    })

    it('sorts an optimistic (unstamped) comment last', () => {
        const threads = buildCommentThreads([comment('new', '')])
        const feed = buildActivityFeed(threads, [
            activity('a1', 'title', '2026-01-05 00:00:00.000Z'),
        ])
        expect(feed.map(e => e.id)).toEqual(['a1', 'new'])
    })
})

describe('describeActivity', () => {
    it('names lists, labels and members from the context', () => {
        expect(
            describeActivity(activity('a', 'moved', '', { from: 'l1', to: 'l2' }), ctx).text
        ).toBe('moved this from To do to Doing')
        expect(describeActivity(activity('a', 'label_added', '', { to: 'lb1' }), ctx).text).toBe(
            'added the label Bug'
        )
        expect(describeActivity(activity('a', 'assignee_added', '', { to: 'u2' }), ctx).text).toBe(
            'assigned Sam Doe'
        )
        expect(describeActivity(activity('a', 'reporter', '', { to: '' }), ctx).text).toBe(
            'cleared the reporter'
        )
    })

    it('falls back to generic nouns for ids that no longer resolve', () => {
        expect(
            describeActivity(activity('a', 'moved', '', { from: 'gone', to: 'l2' }), ctx).text
        ).toBe('moved this from a list to Doing')
        expect(
            describeActivity(activity('a', 'label_removed', '', { from: 'gone' }), ctx).text
        ).toBe('removed the label a label')
        expect(
            describeActivity(activity('a', 'assignee_removed', '', { from: 'gone' }), ctx).text
        ).toBe('unassigned someone')
    })

    it('formats a due date as the day it names and reports a clear', () => {
        expect(
            describeActivity(activity('a', 'due', '', { to: '2026-09-12 00:00:00.000Z' }), ctx).text
        ).toBe('set the due date to Sep 12')
        expect(describeActivity(activity('a', 'due', '', { to: '' }), ctx).text).toBe(
            'cleared the due date'
        )
    })

    it('leaves the actor undefined for a system row', () => {
        const described = describeActivity(activity('a', 'created', '', { actor: undefined }), ctx)
        expect(described.actor).toBeUndefined()
        expect(described.text).toBe('created this card')
    })

    it('covers the remaining kinds', () => {
        expect(describeActivity(activity('a', 'priority', '', { to: 'high' }), ctx).text).toBe(
            'set the priority to High'
        )
        expect(describeActivity(activity('a', 'estimate', '', { to: '5' }), ctx).text).toBe(
            'set the estimate to 5 pts'
        )
        expect(
            describeActivity(activity('a', 'start', '', { to: '2026-09-10' }), ctx).text
        ).toMatch(/^set the start date to Sep 10$/)
        expect(describeActivity(activity('a', 'start', '', { from: '2026-09-10' }), ctx).text).toBe(
            'cleared the start date'
        )
        const instant = new Date(2026, 8, 12, 14, 30).toISOString()
        expect(describeActivity(activity('a', 'due', '', { to: instant }), ctx).text).toMatch(
            /^set the due date to Sep 12, 2:30 PM$/
        )
        expect(describeActivity(activity('a', 'estimate', '', { from: '5' }), ctx).text).toBe(
            'cleared the estimate'
        )
        expect(describeActivity(activity('a', 'title', '', { from: 'Old' }), ctx).text).toBe(
            'renamed this from “Old”'
        )
        expect(
            describeActivity(activity('a', 'checklist_done', '', { to: 'Ship' }), ctx).text
        ).toBe('completed “Ship”')
        expect(
            describeActivity(activity('a', 'attachment_added', '', { to: 'x.png' }), ctx).text
        ).toBe('attached x.png')
        expect(describeActivity(activity('a', 'parent', '', { to: 'cd1' }), ctx).text).toBe(
            'made this a sub-task of OTTER-4'
        )
        expect(describeActivity(activity('a', 'parent', '', { from: 'cd1' }), ctx).text).toBe(
            'removed this from OTTER-4'
        )
        // A keyless board falls back to the title rather than a raw record id.
        expect(describeActivity(activity('a', 'parent', '', { to: 'cd2' }), ctx).text).toBe(
            'made this a sub-task of Untitled epic'
        )
        // Un-parenting BY DELETING the parent is ordinary — the relation does
        // not cascade — so the row outlives the card it names.
        expect(describeActivity(activity('a', 'parent', '', { from: 'gone' }), ctx).text).toBe(
            'removed this from another card'
        )
        // `from` is the link type and `to` the other card — the shape
        // server/card_links.go writes onto BOTH ends.
        expect(
            describeActivity(activity('a', 'link_added', '', { from: 'blocks', to: 'cd1' }), ctx)
                .text
        ).toBe('linked this as blocking OTTER-4')
        expect(
            describeActivity(
                activity('a', 'link_added', '', { from: 'duplicates', to: 'cd1' }),
                ctx
            ).text
        ).toBe('linked this as a duplicate of OTTER-4')
        expect(
            describeActivity(activity('a', 'link_removed', '', { from: 'blocks', to: 'cd1' }), ctx)
                .text
        ).toBe('unlinked this from OTTER-4')
        // A type this build does not know renders as a plain "to" rather than
        // as itself, so a later addition cannot read like a bug.
        expect(
            describeActivity(activity('a', 'link_added', '', { from: 'mystery', to: 'cd1' }), ctx)
                .text
        ).toBe('linked this to OTTER-4')
        expect(describeActivity(activity('a', 'archived', ''), ctx).text).toBe('archived this card')
        expect(describeActivity(activity('a', 'restored', ''), ctx).text).toBe('restored this card')
        expect(describeActivity(activity('a', 'description', ''), ctx).text).toBe(
            'edited the description'
        )
        expect(
            describeActivity(activity('a', 'moved_board', '', { from: 'OTTER-3' }), ctx).text
        ).toBe('moved this here from OTTER-3')
    })
})
