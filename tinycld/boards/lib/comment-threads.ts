// Flat comment rows → one level of threading.
//
// Pure and outside the component so the edge cases below can be tested without
// React. They are not hypothetical: `parent` is a plain relation with no
// integrity guarantee beyond pointing at some boards_comments row, and the
// on-demand sync means a client can hold a reply whose parent has not arrived.
import type { BoardComment } from '../types'

/** A top-level comment with its direct replies. */
export interface CommentThread {
    comment: BoardComment
    replies: BoardComment[]
}

/**
 * Group `comments` into threads, preserving their incoming order.
 *
 * DELIBERATELY ONE LEVEL DEEP: a reply to a reply attaches to the top-level
 * comment it descends from rather than nesting further. Unbounded nesting in a
 * 500px side peek produces columns a few words wide, and a card discussion is
 * not a forum.
 *
 * Two cases that must not lose a comment:
 *
 *  - An ORPHAN — `parent` names a row this client does not have, because it was
 *    deleted or has not synced — is promoted to top level. Dropping it would
 *    make a comment vanish with no indication.
 *  - A CYCLE (a → b → a, reachable only through a hand-edited row) terminates
 *    at the first repeat instead of looping forever.
 */
export function buildCommentThreads(comments: BoardComment[]): CommentThread[] {
    const byId = new Map(comments.map(comment => [comment.id, comment]))
    const isRoot = (comment: BoardComment) => !comment.parent || !byId.has(comment.parent)

    const rootIdFor = (comment: BoardComment): string => {
        let current = comment
        const seen = new Set<string>([current.id])
        while (!isRoot(current)) {
            const parent = byId.get(current.parent)
            if (!parent || seen.has(parent.id)) return current.id
            seen.add(parent.id)
            current = parent
        }
        return current.id
    }

    const threads = new Map<string, CommentThread>()
    for (const comment of comments) {
        if (isRoot(comment)) threads.set(comment.id, { comment, replies: [] })
    }

    for (const comment of comments) {
        if (isRoot(comment)) continue
        const thread = threads.get(rootIdFor(comment))
        // A comment inside a cycle resolves to a root that is not itself a
        // thread; surface it at top level rather than discarding it.
        if (thread) thread.replies.push(comment)
        else threads.set(comment.id, { comment, replies: [] })
    }

    return comments.flatMap(comment => {
        const thread = threads.get(comment.id)
        return thread && thread.comment.id === comment.id ? [thread] : []
    })
}
