import type { CoreStores } from '@tinycld/core/lib/pocketbase'
import type { Schema } from '@tinycld/core/types/pbSchema'
import type { createCollection } from 'pbtsdb/core'
import { BasicIndex } from 'pbtsdb/core'

// The generated Schema already carries the cards_* collections and their
// relations — it is produced by replaying the on-disk migrations, ours
// included. So there is no separate package schema to intersect in; the
// hand-written CardsSchema this used to merge was a restatement of what the
// generator emits (and typed the multi-relations as scalars, which was wrong).
type MergedSchema = Schema

const indexed = {
    autoIndex: 'eager' as const,
    defaultIndexType: BasicIndex,
}

export function registerCollections(
    newCollection: ReturnType<typeof createCollection<MergedSchema>>,
    coreStores: CoreStores
) {
    // `next_number` is the card-number allocator's state (see
    // server/card_number.go) — server-owned, never written by a client, and
    // absent from a new board's insert so it starts at the column default.
    // `slug` is NOT omitted: it is the one half of a card key a person chooses,
    // and the New board dialog sends it.
    const cards_projects = newCollection('cards_projects', {
        omitOnInsert: ['created', 'updated', 'next_number'] as const,
        collectionOptions: indexed,
    })

    // Expanded on `user` so the header avatar stack and the share dialog can
    // render member names without a second query.
    const cards_project_members = newCollection('cards_project_members', {
        omitOnInsert: ['created', 'updated'] as const,
        expand: { project: cards_projects, user: coreStores.users },
        collectionOptions: indexed,
    })

    // Owner-only by rule, so this syncs a handful of rows at most.
    const cards_share_links = newCollection('cards_share_links', {
        omitOnInsert: ['created', 'updated'] as const,
        collectionOptions: indexed,
    })

    const cards_labels = newCollection('cards_labels', {
        omitOnInsert: ['created', 'updated'] as const,
        collectionOptions: indexed,
    })

    const cards_lists = newCollection('cards_lists', {
        omitOnInsert: ['created', 'updated'] as const,
        collectionOptions: indexed,
    })

    // Eager, not on-demand: a board renders every card in every column at once,
    // so on-demand would waterfall the whole screen.
    //
    // No `expand`: assignees resolve against `users` and labels against
    // cards_labels, both already loaded eagerly, so expanding would ship a
    // duplicate copy of those rows with every card. Consumers look them up by id.
    // `number` is omitted on insert because the server owns it: the
    // OnRecordCreate hook in server/card_number.go allocates it from the
    // board's sequence and overwrites anything the body carried. Same shape as
    // mail's `webhook_secret`. The optimistically-inserted card therefore has
    // no number — and so no key — until the server echo lands, which
    // formatCardKey renders as ''.
    // `archived_at` is server-owned too (server/card_archived.go stamps it
    // when `archived` flips), so an insert never carries it.
    const cards_cards = newCollection('cards_cards', {
        omitOnInsert: [
            'created',
            'updated',
            'number',
            'archived_at',
            // The due-notice stamps (server/due_notices.go) are the ticker's;
            // an insert never carries them.
            'due_soon_notified_at',
            'overdue_notified_at',
            'list_changed_at',
        ] as const,
        collectionOptions: indexed,
    })

    // The next three are read only for the card that is currently open, so they
    // sync on demand rather than dragging every card's checklist, comment thread
    // and attachment list into memory for a board the user is only scanning.
    //
    // Consequence to keep in mind when wiring the board face: a checklist ratio
    // or attachment count is not available until the card is opened. If those
    // badges are wanted at rest, the fix is a denormalized counter on the card
    // (mail_threads.has_attachments is the precedent), not eager sync.
    const cards_checklist_items = newCollection('cards_checklist_items', {
        omitOnInsert: ['created', 'updated'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // `author` resolves against the eager `users` store — no expand, same
    // duplicate-row reasoning as cards_cards.
    const cards_comments = newCollection('cards_comments', {
        omitOnInsert: ['created', 'updated'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    const cards_attachments = newCollection('cards_attachments', {
        omitOnInsert: ['created', 'updated'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // Server-written history (server/activity.go); the client only reads it,
    // and only for the open card. No expand: `actor` resolves against the
    // eager `users` store like every other user relation here.
    const cards_activity = newCollection('cards_activity', {
        omitOnInsert: ['created'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // Who follows a card. On-demand: read for the open card (the Watch
    // button) and for the My cards "Watching" tab.
    const cards_card_watchers = newCollection('cards_card_watchers', {
        omitOnInsert: ['created'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // Emoji on comments. On-demand like the comments they hang off; read
    // for the open card in one query keyed by `card` (see the migration for
    // why the row carries it). No expand: `user` resolves against the eager
    // `users` store, and the bar only counts.
    const cards_comment_reactions = newCollection('cards_comment_reactions', {
        omitOnInsert: ['created'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    return {
        cards_activity,
        cards_card_watchers,
        cards_comment_reactions,
        cards_projects,
        cards_project_members,
        cards_share_links,
        cards_labels,
        cards_lists,
        cards_cards,
        cards_checklist_items,
        cards_comments,
        cards_attachments,
    }
}
