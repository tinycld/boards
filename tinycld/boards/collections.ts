import type { CoreStores } from '@tinycld/core/lib/pocketbase'
import type { Schema } from '@tinycld/core/types/pbSchema'
import type { createCollection } from 'pbtsdb/core'
import { BasicIndex } from 'pbtsdb/core'

// The generated Schema already carries the boards_* collections and their
// relations — it is produced by replaying the on-disk migrations, ours
// included. So there is no separate package schema to intersect in; the
// hand-written BoardsSchema this used to merge was a restatement of what the
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
    const boards_projects = newCollection('boards_projects', {
        omitOnInsert: ['created', 'updated', 'next_number'] as const,
        collectionOptions: indexed,
    })

    // Expanded on `user` so the header avatar stack and the share dialog can
    // render member names without a second query.
    const boards_project_members = newCollection('boards_project_members', {
        omitOnInsert: ['created', 'updated'] as const,
        expand: { project: boards_projects, user: coreStores.users },
        collectionOptions: indexed,
    })

    // Owner-only by rule, so this syncs a handful of rows at most.
    const boards_share_links = newCollection('boards_share_links', {
        omitOnInsert: ['created', 'updated'] as const,
        collectionOptions: indexed,
    })

    const boards_labels = newCollection('boards_labels', {
        omitOnInsert: ['created', 'updated'] as const,
        collectionOptions: indexed,
    })

    // Eager like boards_labels, and for the same reason: an epic chip renders on
    // the card face, so every card on screen needs its epic's name and color
    // resolvable without a per-card fetch. A board holds a handful of epics.
    const boards_epics = newCollection('boards_epics', {
        omitOnInsert: ['created', 'updated'] as const,
        collectionOptions: indexed,
    })

    const boards_lists = newCollection('boards_lists', {
        omitOnInsert: ['created', 'updated'] as const,
        collectionOptions: indexed,
    })

    // Eager, not on-demand: a board renders every card in every column at once,
    // so on-demand would waterfall the whole screen.
    //
    // No `expand`: assignees resolve against `users` and labels against
    // boards_labels, both already loaded eagerly, so expanding would ship a
    // duplicate copy of those rows with every card. Consumers look them up by id.
    // `number` is omitted on insert because the server owns it: the
    // OnRecordCreate hook in server/card_number.go allocates it from the
    // board's sequence and overwrites anything the body carried. Same shape as
    // mail's `webhook_secret`. The optimistically-inserted card therefore has
    // no number — and so no key — until the server echo lands, which
    // formatCardKey renders as ''.
    // `archived_at` is server-owned too (server/card_archived.go stamps it
    // when `archived` flips), so an insert never carries it.
    const boards_cards = newCollection('boards_cards', {
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
    const boards_checklist_items = newCollection('boards_checklist_items', {
        omitOnInsert: ['created', 'updated'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // `author` resolves against the eager `users` store — no expand, same
    // duplicate-row reasoning as boards_cards.
    const boards_comments = newCollection('boards_comments', {
        omitOnInsert: ['created', 'updated'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    const boards_attachments = newCollection('boards_attachments', {
        omitOnInsert: ['created', 'updated'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // Server-written history (server/activity.go); the client only reads it,
    // and only for the open card. No expand: `actor` resolves against the
    // eager `users` store like every other user relation here.
    const boards_activity = newCollection('boards_activity', {
        omitOnInsert: ['created'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // Who follows a card. On-demand: read for the open card (the Watch
    // button) and for the My cards "Watching" tab.
    const boards_card_watchers = newCollection('boards_card_watchers', {
        omitOnInsert: ['created'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // Emoji on comments. On-demand like the comments they hang off; read
    // for the open card in one query keyed by `card` (see the migration for
    // why the row carries it). No expand: `user` resolves against the eager
    // `users` store, and the bar only counts.
    const boards_comment_reactions = newCollection('boards_comment_reactions', {
        omitOnInsert: ['created'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // Links between cards. On-demand like watchers and reactions: read for the
    // open card only.
    //
    // THE ONE COLLECTION HERE THAT CROSSES BOARDS. Every other row names one
    // `project` and syncs with the board it belongs to; a link names two cards
    // and no project at all (see pb-migrations/1980000016 for why there is no
    // denormalized column). A consequence the UI has to handle rather than
    // wish away: the far card of a cross-board link is often NOT in the local
    // store, either because the reader cannot see it or because that board has
    // not synced — lib/card-links.ts is where those two are told apart.
    const boards_card_links = newCollection('boards_card_links', {
        omitOnInsert: ['created'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    return {
        boards_activity,
        boards_card_links,
        boards_card_watchers,
        boards_comment_reactions,
        boards_projects,
        boards_project_members,
        boards_share_links,
        boards_labels,
        boards_epics,
        boards_lists,
        boards_cards,
        boards_checklist_items,
        boards_comments,
        boards_attachments,
    }
}
