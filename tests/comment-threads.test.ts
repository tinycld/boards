import { describe, expect, it } from 'vitest'
import { buildCommentThreads } from '../tinycld/cards/lib/comment-threads'
import type { BoardComment } from '../tinycld/cards/types'

function comment(id: string, parent = '', body = id): BoardComment {
    return {
        id,
        author: { id: 'u1', firstName: 'Maya', lastName: 'Kim' },
        created: '2026-08-05T10:00:00Z',
        body,
        parent,
    }
}

describe('buildCommentThreads', () => {
    it('returns an empty list for no comments', () => {
        expect(buildCommentThreads([])).toEqual([])
    })

    it('treats parentless comments as roots', () => {
        const threads = buildCommentThreads([comment('a'), comment('b')])
        expect(threads.map(t => t.comment.id)).toEqual(['a', 'b'])
        expect(threads.every(t => t.replies.length === 0)).toBe(true)
    })

    it('nests a reply under its parent', () => {
        const threads = buildCommentThreads([comment('a'), comment('b', 'a')])
        expect(threads).toHaveLength(1)
        expect(threads[0].comment.id).toBe('a')
        expect(threads[0].replies.map(r => r.id)).toEqual(['b'])
    })

    it('preserves incoming order for roots and replies', () => {
        const threads = buildCommentThreads([
            comment('a'),
            comment('b'),
            comment('a1', 'a'),
            comment('a2', 'a'),
        ])
        expect(threads.map(t => t.comment.id)).toEqual(['a', 'b'])
        expect(threads[0].replies.map(r => r.id)).toEqual(['a1', 'a2'])
    })

    // The flattening rule: depth is capped at one, so a reply-to-a-reply joins
    // the top-level thread rather than nesting a third level.
    it('flattens a reply to a reply onto the top-level thread', () => {
        const threads = buildCommentThreads([
            comment('a'),
            comment('b', 'a'),
            comment('c', 'b'),
            comment('d', 'c'),
        ])
        expect(threads).toHaveLength(1)
        expect(threads[0].comment.id).toBe('a')
        expect(threads[0].replies.map(r => r.id)).toEqual(['b', 'c', 'd'])
    })

    // An orphan must surface, not vanish: the parent may be deleted, or simply
    // not synced yet on an on-demand collection.
    it('promotes a reply whose parent is missing to top level', () => {
        const threads = buildCommentThreads([comment('a'), comment('orphan', 'gone')])
        expect(threads.map(t => t.comment.id)).toEqual(['a', 'orphan'])
    })

    it('keeps every comment exactly once', () => {
        const input = [
            comment('a'),
            comment('b', 'a'),
            comment('c', 'b'),
            comment('d'),
            comment('e', 'missing'),
        ]
        const threads = buildCommentThreads(input)
        const seen = threads.flatMap(t => [t.comment.id, ...t.replies.map(r => r.id)])
        expect(seen.sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    })

    it('terminates on a parent cycle instead of hanging', () => {
        // Only reachable via a hand-edited row, but an infinite loop here would
        // freeze the whole detail view.
        const threads = buildCommentThreads([comment('a', 'b'), comment('b', 'a')])
        const seen = threads.flatMap(t => [t.comment.id, ...t.replies.map(r => r.id)])
        expect(seen.sort()).toEqual(['a', 'b'])
    })

    it('handles a comment that is its own parent', () => {
        const threads = buildCommentThreads([comment('self', 'self')])
        const seen = threads.flatMap(t => [t.comment.id, ...t.replies.map(r => r.id)])
        expect(seen).toEqual(['self'])
    })
})
