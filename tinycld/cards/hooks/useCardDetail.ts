import { eq } from '@tanstack/db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useMemo } from 'react'
import { toBoardMember } from '../lib/board-project'
import type { BoardChecklistItem, BoardComment } from '../types'

/**
 * A card's checklist and comments.
 *
 * Separate from useActiveBoard because these two collections register with
 * `syncMode: 'on-demand'`: a `where` on `card` compiles to a server-side
 * PocketBase filter, so opening a card fetches only that card's rows rather
 * than every comment on every board. The board face reads the denormalized
 * counters on the card instead.
 */
export function useCardDetail(cardId: string) {
    const [checklistCollection, commentsCollection, usersCollection] = useStore(
        'cards_checklist_items',
        'cards_comments',
        'users'
    )

    const { data: itemRows, isLoading: checklistLoading } = useOrgLiveQuery(
        query => {
            if (!cardId) return null
            return query
                .from({ item: checklistCollection })
                .where(({ item }) => eq(item.card, cardId))
        },
        [cardId]
    )

    // Joined to users for author names: cards_comments registers no expand
    // (on-demand fetches would ship a duplicate user row per comment), so the
    // author resolves against the eagerly-synced users collection.
    const { data: commentRows, isLoading: commentsLoading } = useOrgLiveQuery(
        query => {
            if (!cardId) return null
            return query
                .from({ comment: commentsCollection })
                .innerJoin({ author: usersCollection }, ({ comment, author }) =>
                    eq(comment.author, author.id)
                )
                .where(({ comment }) => eq(comment.card, cardId))
        },
        [cardId]
    )

    const checklist = useMemo<BoardChecklistItem[]>(
        () =>
            (itemRows ?? [])
                .map(item => ({
                    id: item.id,
                    title: item.title,
                    isDone: item.is_done,
                    position: item.position,
                }))
                .sort((a, b) =>
                    a.position === b.position
                        ? a.id.localeCompare(b.id)
                        : a.position.localeCompare(b.position)
                ),
        [itemRows]
    )

    const comments = useMemo<BoardComment[]>(
        () =>
            (commentRows ?? [])
                .map(row => ({
                    id: row.comment.id,
                    author: toBoardMember(row.author),
                    created: row.comment.created,
                    body: row.comment.body,
                    parent: row.comment.parent,
                }))
                // Oldest first. An optimistically-inserted comment has created
                // '' until PocketBase answers, which would sort it to the TOP
                // of the thread and then jump it to the bottom — so '' is
                // treated as newest, where the composer just put it.
                .sort((a, b) => {
                    if (a.created === b.created) return a.id.localeCompare(b.id)
                    if (a.created === '') return 1
                    if (b.created === '') return -1
                    return a.created.localeCompare(b.created)
                }),
        [commentRows]
    )

    return { checklist, comments, isLoading: checklistLoading || commentsLoading }
}
