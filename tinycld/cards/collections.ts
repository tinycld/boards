import type { CoreStores } from '@tinycld/core/lib/pocketbase'
import type { Schema } from '@tinycld/core/types/pbSchema'
import type { createCollection } from 'pbtsdb/core'
import { BasicIndex } from 'pbtsdb/core'
import type { CardsSchema } from './types'

type MergedSchema = Schema & CardsSchema

const indexed = {
    autoIndex: 'eager' as const,
    defaultIndexType: BasicIndex,
}

export function registerCollections(
    newCollection: ReturnType<typeof createCollection<MergedSchema>>,
    coreStores: CoreStores
) {
    const cards_projects = newCollection('cards_projects', {
        omitOnInsert: ['created', 'updated'] as const,
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
    const cards_cards = newCollection('cards_cards', {
        omitOnInsert: ['created', 'updated'] as const,
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

    return {
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
