import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { mimeFromFilename } from '@tinycld/core/file-viewer/file-naming'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { materialize } from 'pbtsdb'
import { useMemo } from 'react'
import { attachmentDisplayName } from '../lib/attachment-source'
import { toBoardMember } from '../lib/board-project'
import { byCreatedThenId } from '../lib/created-order'
import type { BoardActivity, BoardAttachment, BoardChecklistItem, BoardComment } from '../types'

/**
 * Everything hanging off one card — checklist, comments, attachments,
 * activity, watchers, comment reactions, links and PR links — from ONE request.
 *
 * The card is read through a view that fetches every child back-relation
 * declared on `boards_cards` (collections.ts): PocketBase returns the card
 * with its children, pbtsdb files each child into its own on-demand
 * collection and marks the subset for this card complete, and the includes
 * below — each a single-field equality on the card's foreign key — are served
 * from the store. Anchoring on the card also means the request always
 * carries the card row, so a fresh card with no children is never an empty
 * filtered response (the pattern PocketBase throttles: >3 empty filtered
 * lists in 3s trip `randomizedThrottle(500)` in upstream apis/record_crud.go).
 *
 * The to-one joins inside the includes (author, uploader, actor) resolve
 * names against the eager `users` store and add no rows. `actor` is optional
 * (a rule or seed has none), so that join is a LEFT one: a system row must
 * survive with no user beside it.
 *
 * Every hook that reads a card's children (useCardDetail, useCardWatch,
 * useCommentReactions, useCardLinks, usePrLinks) calls this with the same
 * card id, so they share the one query rather than each racing the parent
 * fetch with a filtered request of their own.
 *
 * `isReady` is the query having actually SETTLED, and it exists to gate
 * EDITING, not just display. An unsettled query is indistinguishable from a
 * genuinely empty card, so offering a composer during that window invites a
 * user to re-add items they already have.
 */
export function useCardChildren(cardId: string) {
    const [
        cardsCollection,
        checklistCollection,
        commentsCollection,
        attachmentsCollection,
        activityCollection,
        watchersCollection,
        commentReactionsCollection,
        linksCollection,
        prLinksCollection,
        usersCollection,
    ] = useStore(
        'boards_cards',
        'boards_checklist_items',
        'boards_comments',
        'boards_attachments',
        'boards_activity',
        'boards_card_watchers',
        'boards_comment_reactions',
        'boards_card_links',
        'boards_pr_links',
        'users'
    )

    const { data, isReady } = useLiveQuery({
        query: query => {
            if (!cardId) return null
            const cardWithChildren = cardsCollection.fetchRelations(
                'boards_checklist_items_via_card',
                'boards_comments_via_card',
                'boards_attachments_via_card',
                'boards_activity_via_card',
                'boards_card_watchers_via_card',
                'boards_comment_reactions_via_card',
                'boards_card_links_via_source',
                'boards_card_links_via_target',
                'boards_pr_links_via_card'
            )
            // Every include correlates on `card.id` — the parent REF — never
            // on the `cardId` constant: the include builder rejects a where
            // with no parent/child equality, and a constant would not be a
            // subset pbtsdb serves from the store.
            return query
                .from({ card: cardWithChildren })
                .where(({ card }) => eq(card.id, cardId))
                .select(({ card }) => ({
                    id: card.id,
                    items: materialize(
                        query
                            .from({ item: checklistCollection })
                            .where(({ item }) => eq(item.card, card.id))
                    ),
                    comments: materialize(
                        query
                            .from({ comment: commentsCollection })
                            .innerJoin({ author: usersCollection }, ({ comment, author }) =>
                                eq(comment.author, author.id)
                            )
                            .where(({ comment }) => eq(comment.card, card.id))
                    ),
                    attachments: materialize(
                        query
                            .from({ attachment: attachmentsCollection })
                            .innerJoin({ uploader: usersCollection }, ({ attachment, uploader }) =>
                                eq(attachment.uploaded_by, uploader.id)
                            )
                            .where(({ attachment }) => eq(attachment.card, card.id))
                    ),
                    activity: materialize(
                        query
                            .from({ entry: activityCollection })
                            .leftJoin({ actor: usersCollection }, ({ entry, actor }) =>
                                eq(entry.actor, actor.id)
                            )
                            .where(({ entry }) => eq(entry.card, card.id))
                    ),
                    watchers: materialize(
                        query
                            .from({ watcher: watchersCollection })
                            .where(({ watcher }) => eq(watcher.card, card.id))
                    ),
                    commentReactions: materialize(
                        query
                            .from({ reaction: commentReactionsCollection })
                            .where(({ reaction }) => eq(reaction.card, card.id))
                    ),
                    // A link names this card as either end. Two includes, one
                    // per end, because `or(source, target)` spans two fields
                    // and is not a subset the store can prove complete.
                    outgoingLinks: materialize(
                        query
                            .from({ link: linksCollection })
                            .where(({ link }) => eq(link.source, card.id))
                    ),
                    incomingLinks: materialize(
                        query
                            .from({ link: linksCollection })
                            .where(({ link }) => eq(link.target, card.id))
                    ),
                    // Tombstoned rows (`unlinked`) are filtered by the reader,
                    // not here: a second predicate would push the read to the
                    // server. See pb-migrations/1980000021 for the tombstone.
                    prLinks: materialize(
                        query
                            .from({ link: prLinksCollection })
                            .where(({ link }) => eq(link.card, card.id))
                    ),
                }))
                .findOne()
        },
    })

    return { children: data ?? null, isReady }
}

export type CardChildren = NonNullable<ReturnType<typeof useCardChildren>['children']>

/**
 * The card detail's four sections — checklist, comments, attachments and
 * activity — in render order, from the shared card query.
 */
export function useCardDetail(cardId: string) {
    const { children, isReady } = useCardChildren(cardId)
    const items = children?.items
    const commentRows = children?.comments
    const attachmentRows = children?.attachments
    const activityRows = children?.activity

    const checklist = useMemo<BoardChecklistItem[]>(
        () =>
            (items ?? [])
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
        [items]
    )

    const comments = useMemo<BoardComment[]>(
        () =>
            (commentRows ?? [])
                .map(joined => ({
                    id: joined.comment.id,
                    author: toBoardMember(joined.author),
                    // ?? '': the optimistic insert draft carries NO created at
                    // all — the comparator's ''-is-newest handling only works
                    // if the miss is normalized here rather than reaching
                    // localeCompare as undefined (the reply-save crash).
                    created: joined.comment.created ?? '',
                    editedAt: joined.comment.edited_at ?? '',
                    body: joined.comment.body,
                    parent: joined.comment.parent,
                }))
                // Oldest first; '' (optimistic) sorts last, where the composer
                // just put it.
                .sort(byCreatedThenId),
        [commentRows]
    )

    const attachments = useMemo<BoardAttachment[]>(
        () =>
            (attachmentRows ?? [])
                .map(joined => ({
                    id: joined.attachment.id,
                    fileName: joined.attachment.file,
                    displayName: attachmentDisplayName(joined.attachment),
                    size: joined.attachment.size ?? 0,
                    mimeType: mimeFromFilename(joined.attachment.file),
                    uploadedBy: toBoardMember(joined.uploader),
                    created: joined.attachment.created ?? '',
                }))
                // Newest last, matching the comment thread: an attachment is
                // appended to a list the reader is already scanning downwards.
                // '' (optimistic) belongs where the upload just put it — at
                // the end.
                .sort(byCreatedThenId),
        [attachmentRows]
    )

    const activity = useMemo<BoardActivity[]>(
        () =>
            (activityRows ?? [])
                .map(joined => ({
                    id: joined.entry.id,
                    kind: joined.entry.kind,
                    actor: joined.actor ? toBoardMember(joined.actor) : undefined,
                    from: joined.entry.from,
                    to: joined.entry.to,
                    created: joined.entry.created ?? '',
                }))
                .sort(byCreatedThenId),
        [activityRows]
    )

    return { checklist, comments, attachments, activity, isReady }
}
