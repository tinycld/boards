import { eq } from '@tanstack/db'
import { mimeFromFilename } from '@tinycld/core/file-viewer/file-naming'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useMemo } from 'react'
import { attachmentDisplayName } from '../lib/attachment-source'
import { toBoardMember } from '../lib/board-project'
import { byCreatedThenId } from '../lib/created-order'
import type { BoardActivity, BoardAttachment, BoardChecklistItem, BoardComment } from '../types'

/**
 * Row-wise joins across three to-many relations yield the cartesian product of
 * the three child sets, so each child repeats once per combination. Collapse
 * back to one entry per id, preserving first-seen order.
 *
 * A missing value is a LEFT-join miss — this card has none of that child — not
 * a row to keep. Module-level so it is not a fresh identity on every render.
 */
function collect<TRowSet, TRow, TOut>(
    rows: TRowSet[] | undefined,
    pick: (row: TRowSet) => TRow | undefined | null,
    keyOf: (row: TRow) => string,
    map: (row: TRow) => TOut
): TOut[] {
    const seen = new Map<string, TOut>()
    for (const row of rows ?? []) {
        const value = pick(row)
        if (!value) continue
        const key = keyOf(value)
        if (!seen.has(key)) seen.set(key, map(value))
    }
    return Array.from(seen.values())
}

/**
 * Everything the card detail renders — checklist, comments and attachments —
 * from ONE query.
 *
 * The card is the driving row and each child set joins in as a SUBQUERY already
 * narrowed to this card. Driving from `cards_cards` rather than from the
 * children is what makes this one round trip instead of three, and it also
 * removes a self-inflicted stall: a freshly opened card has no checklist, no
 * comments and no attachments, so the three per-child reads this replaces were
 * three consecutive FILTERED READS RETURNING ZERO ROWS — exactly the pattern
 * PocketBase throttles on purpose (>3 empty filtered responses in 3s trips
 * `randomizedThrottle(500)` in upstream apis/record_crud.go: a random 0-500ms
 * sleep while the SQL itself measures 0.00ms). Anchoring on the card means the
 * result always carries the card row, so it is never empty and that gate never
 * fires.
 *
 * LEFT joins, not inner: a card with no comments must still return its own row.
 * An inner join would drop the card entirely and render an empty detail.
 *
 * Narrowing each child set INSIDE its subquery keeps every join condition the
 * single equality TanStack DB requires, and stops the product widening to other
 * cards' children.
 *
 * `isReady` is the query having actually SETTLED, and it exists to gate EDITING,
 * not just display. An unsettled query is indistinguishable from a genuinely
 * empty card, so offering a composer during that window invites a user to
 * re-add items they already have.
 */
export function useCardDetail(cardId: string) {
    const [
        cardsCollection,
        checklistCollection,
        commentsCollection,
        attachmentsCollection,
        activityCollection,
        usersCollection,
    ] = useStore(
        'cards_cards',
        'cards_checklist_items',
        'cards_comments',
        'cards_attachments',
        'cards_activity',
        'users'
    )

    const { data: rows, isReady } = useOrgLiveQuery(
        query => {
            if (!cardId) return null

            const items = query
                .from({ item: checklistCollection })
                .where(({ item }) => eq(item.card, cardId))

            // The author/uploader joins are to-ONE, so they add no rows — they
            // resolve names against the eagerly-synced `users` store, which is
            // why neither collection registers an `expand` of its own.
            const comments = query
                .from({ comment: commentsCollection })
                .innerJoin({ author: usersCollection }, ({ comment, author }) =>
                    eq(comment.author, author.id)
                )
                .where(({ comment }) => eq(comment.card, cardId))

            const attachments = query
                .from({ attachment: attachmentsCollection })
                .innerJoin({ uploader: usersCollection }, ({ attachment, uploader }) =>
                    eq(attachment.uploaded_by, uploader.id)
                )
                .where(({ attachment }) => eq(attachment.card, cardId))

            // `actor` is optional (a rule or seed has none), so this join is
            // a LEFT one: a system row must survive with no user beside it.
            const activity = query
                .from({ entry: activityCollection })
                .leftJoin({ actor: usersCollection }, ({ entry, actor }) =>
                    eq(entry.actor, actor.id)
                )
                .where(({ entry }) => eq(entry.card, cardId))

            // A fourth to-many join widens the cartesian product `collect`
            // dedupes; at kanban scale (tens of rows each) that stays cheap.
            return query
                .from({ card: cardsCollection })
                .where(({ card }) => eq(card.id, cardId))
                .leftJoin({ items }, ({ card, items }) => eq(items.card, card.id))
                .leftJoin({ comments }, ({ card, comments }) => eq(comments.comment.card, card.id))
                .leftJoin({ attachments }, ({ card, attachments }) =>
                    eq(attachments.attachment.card, card.id)
                )
                .leftJoin({ activity }, ({ card, activity }) => eq(activity.entry.card, card.id))
        },
        [cardId]
    )

    const checklist = useMemo<BoardChecklistItem[]>(
        () =>
            collect(
                rows,
                row => row.items,
                item => item.id,
                item => ({
                    id: item.id,
                    title: item.title,
                    isDone: item.is_done,
                    position: item.position,
                })
            ).sort((a, b) =>
                a.position === b.position
                    ? a.id.localeCompare(b.id)
                    : a.position.localeCompare(b.position)
            ),
        [rows]
    )

    const comments = useMemo<BoardComment[]>(
        () =>
            collect(
                rows,
                row => row.comments,
                joined => joined.comment.id,
                joined => ({
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
                })
            )
                // Oldest first; '' (optimistic) sorts last, where the composer
                // just put it.
                .sort(byCreatedThenId),
        [rows]
    )

    const attachments = useMemo<BoardAttachment[]>(
        () =>
            collect(
                rows,
                row => row.attachments,
                joined => joined.attachment.id,
                joined => ({
                    id: joined.attachment.id,
                    fileName: joined.attachment.file,
                    displayName: attachmentDisplayName(joined.attachment),
                    size: joined.attachment.size ?? 0,
                    mimeType: mimeFromFilename(joined.attachment.file),
                    uploadedBy: toBoardMember(joined.uploader),
                    created: joined.attachment.created ?? '',
                })
            )
                // Newest last, matching the comment thread: an attachment is
                // appended to a list the reader is already scanning downwards.
                // '' (optimistic) belongs where the upload just put it — at
                // the end.
                .sort(byCreatedThenId),
        [rows]
    )

    const activity = useMemo<BoardActivity[]>(
        () =>
            collect(
                rows,
                row => row.activity,
                joined => joined.entry.id,
                joined => ({
                    id: joined.entry.id,
                    kind: joined.entry.kind,
                    actor: joined.actor ? toBoardMember(joined.actor) : undefined,
                    from: joined.entry.from,
                    to: joined.entry.to,
                    created: joined.entry.created ?? '',
                })
            ).sort(byCreatedThenId),
        [rows]
    )

    return { checklist, comments, attachments, activity, isReady }
}
