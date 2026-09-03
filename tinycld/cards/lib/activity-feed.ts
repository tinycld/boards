// The card's activity feed: comment threads and history rows, interleaved.
//
// Pure, like comment-threads.ts, so the merge order and every sentence can be
// tested without React. Names are resolved HERE from the board's lists,
// labels and members rather than stored on the row — see the migration.

import type { BoardActivity, BoardLabel, BoardMember } from '../types'
import type { CommentThread } from './comment-threads'
import { byCreatedThenId } from './created-order'
import { formatDueDate } from './due-state'
import { type CardPriority, normalizePriority, priorityLabel } from './priority'

export type FeedEntry =
    | { kind: 'thread'; id: string; created: string; thread: CommentThread }
    | { kind: 'activity'; id: string; created: string; item: BoardActivity }

/**
 * Threads and history, oldest first, by the THREAD ROOT's timestamp — a reply
 * stays under its parent however late it came. `''` (an optimistic insert)
 * sorts last, where the composer just put it.
 */
export function buildActivityFeed(
    threads: CommentThread[],
    activity: BoardActivity[]
): FeedEntry[] {
    const entries: FeedEntry[] = [
        ...threads.map(
            (thread): FeedEntry => ({
                kind: 'thread',
                id: thread.comment.id,
                created: thread.comment.created,
                thread,
            })
        ),
        ...activity.map(
            (item): FeedEntry => ({ kind: 'activity', id: item.id, created: item.created, item })
        ),
    ]
    return entries.sort(byCreatedThenId)
}

export interface ActivityContext {
    lists: { id: string; name: string }[]
    labels: BoardLabel[]
    members: BoardMember[]
}

export interface ActivityDescription {
    /** Who did it, or undefined for a system write ("Automatically"). */
    actor?: BoardMember
    /** The sentence after the actor's name: "moved this from To do to Doing". */
    text: string
}

/**
 * One row → one sentence. Ids that no longer resolve fall back to a generic
 * noun rather than the raw id or a blank: "a list", "a label", "someone".
 */
export function describeActivity(item: BoardActivity, ctx: ActivityContext): ActivityDescription {
    const listName = (id: string) => ctx.lists.find(list => list.id === id)?.name ?? 'a list'
    const labelName = (id: string) => ctx.labels.find(label => label.id === id)?.name ?? 'a label'
    const memberName = (id: string) => {
        const member = ctx.members.find(m => m.id === id)
        return member ? `${member.firstName} ${member.lastName}`.trim() : 'someone'
    }
    const dueText = (value: string) => {
        if (!value) return 'no due date'
        const parsed = new Date(value)
        if (Number.isNaN(parsed.getTime())) return value
        return formatDueDate(
            new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
        )
    }

    let text: string
    switch (item.kind) {
        case 'created':
            text = 'created this card'
            break
        case 'moved':
            text = `moved this from ${listName(item.from)} to ${listName(item.to)}`
            break
        case 'moved_board':
            text = item.from ? `moved this here from ${item.from}` : 'moved this from another board'
            break
        case 'assignee_added':
            text = `assigned ${memberName(item.to)}`
            break
        case 'assignee_removed':
            text = `unassigned ${memberName(item.from)}`
            break
        case 'label_added':
            text = `added the label ${labelName(item.to)}`
            break
        case 'label_removed':
            text = `removed the label ${labelName(item.from)}`
            break
        case 'due':
            text = item.to ? `set the due date to ${dueText(item.to)}` : 'cleared the due date'
            break
        case 'title':
            text = `renamed this from “${item.from}”`
            break
        case 'description':
            text = 'edited the description'
            break
        case 'reporter':
            text = item.to ? `set the reporter to ${memberName(item.to)}` : 'cleared the reporter'
            break
        case 'priority':
            text = `set the priority to ${priorityLabel(normalizePriority(item.to) as CardPriority)}`
            break
        case 'archived':
            text = 'archived this card'
            break
        case 'restored':
            text = 'restored this card'
            break
        case 'checklist_done':
            text = `completed “${item.to}”`
            break
        case 'attachment_added':
            text = `attached ${item.to || 'a file'}`
            break
    }
    return { actor: item.actor, text }
}
