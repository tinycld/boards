import type { CoreStores } from '@tinycld/core/lib/pocketbase'
import type { Schema } from '@tinycld/core/types/pbSchema'
import type { createCollection } from 'pbtsdb/core'
import { BasicIndex } from 'pbtsdb/core'

// The generated Schema already carries the boards_* collections and their
// relations in BOTH directions — it is produced by replaying the on-disk
// migrations, ours included. So there is no separate package schema to
// intersect in; the hand-written BoardsSchema this used to merge was a
// restatement of what the generator emits (and typed the multi-relations as
// scalars, which was wrong).
type MergedSchema = Schema

const indexed = {
    autoIndex: 'eager' as const,
    defaultIndexType: BasicIndex,
}

export function registerCollections(
    newCollection: ReturnType<typeof createCollection<MergedSchema>>,
    coreStores: CoreStores
) {
    // HOW A BOARD LOADS. Every board-scoped collection here syncs ON DEMAND,
    // and the board's rows enter the store through ONE request: the board
    // screen reads the project row through a view that fetches the
    // back-relations declared on `boards_projects` below
    // (`boards_cards_via_project` and friends), so PocketBase returns the
    // project with every list, card, label, epic, sprint and card reaction it
    // owns, and pbtsdb files each into its own collection and records that
    // the subset for that project is complete. The includes that read them
    // (`where card.project = project.id`) are then served from the store —
    // no per-collection request, no waterfall, and nothing but the open board
    // in memory. A card opens the same way through `boards_cards`'s own
    // back-relations. See hooks/useActiveBoard.ts and hooks/useCardDetail.ts.
    //
    // Two rules that keep it one request:
    //   - a child query must be a single-field equality on the foreign key
    //     (`eq(list.project, project.id)`); anything else (`and`, a second
    //     field) is not a subset pbtsdb can prove complete and goes to the
    //     server;
    //   - the children are created BEFORE the parents so the relation map
    //     can name their instances.
    //
    // PocketBase caps a back-relation expand at 1000 rows per parent; a
    // capped subset is never marked complete, so a board past that falls back
    // to one filtered request for its cards. Nothing here uses
    // `alwaysFetchRelations`: the board and card screens choose their paths
    // per query, so the sidebar's board list and the pickers fetch plain rows.

    // --- The open card's children. Read for one card at a time, through the
    // card's back-relations; the counters a card face shows at rest
    // (checklist ratio, comment and attachment counts) are denormalized onto
    // the card row for exactly that reason.
    const boards_checklist_items = newCollection('boards_checklist_items', {
        omitOnInsert: ['created', 'updated'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // `author` resolves against the eager `users` store through a join inside
    // the card's include.
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

    // Server-written history (server/activity.go); the client only reads it.
    // `actor` resolves against the eager `users` store like every other user
    // relation here.
    const boards_activity = newCollection('boards_activity', {
        omitOnInsert: ['created'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // Who follows a card: read for the open card (the Watch button) and for
    // the My cards "Watching" tab, which asks for the caller's own rows.
    const boards_card_watchers = newCollection('boards_card_watchers', {
        omitOnInsert: ['created'] as const,
        collectionOptions: indexed,
        syncMode: 'on-demand' as const,
    })

    // Emoji on comments, read for the open card in one subset keyed by `card`
    // (see the migration for why the row carries it). `user` resolves against
    // the eager `users` store, which the chip tooltip reads to name who reacted.
    const boards_comment_reactions = newCollection('boards_comment_reactions', {
        omitOnInsert: ['created'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // Links between cards.
    //
    // THE ONE COLLECTION HERE THAT CROSSES BOARDS. Every other row names one
    // `project` and loads with the board it belongs to; a link names two cards
    // and no project at all (see pb-migrations/1980000016 for why there is no
    // denormalized column), so the card fetches it from both ends
    // (`_via_source` and `_via_target`). A consequence the UI has to handle
    // rather than wish away: the far card of a cross-board link is often NOT
    // in the local store, either because the reader cannot see it or because
    // that board has not loaded — lib/card-links.ts is where those two are
    // told apart.
    const boards_card_links = newCollection('boards_card_links', {
        omitOnInsert: ['created'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // A card's linked pull requests. `created`/`updated` are the standard PB
    // stamps. `state`, `title`, `author` are server-written by the GitHub
    // webhook (server/github_links.go) even for a manually-added link, but
    // they are plain text/select fields with a writable `''` zero-value, so a
    // client insert still supplies it explicitly rather than omitting the
    // column — the `priority: 'none'` convention `boards_cards` follows.
    // `review_state` is the exception: like `boards_cards.pr_review_state`
    // below, its migration declares only `['in_review', 'approved']` — there
    // is no "none" value to write — so it is omitted here instead of cast.
    const boards_pr_links = newCollection('boards_pr_links', {
        omitOnInsert: ['created', 'updated', 'review_state'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // Server-written, like boards_activity, and read only by the sprint
    // charts — one sprint at a time, through its own filtered query.
    const boards_sprint_snapshots = newCollection('boards_sprint_snapshots', {
        omitOnInsert: ['created'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // --- The board's rows, all filed by the project fetch.

    // Votes on cards. The board face shows every card's chips, so the rows
    // load per BOARD with the project and the open card reads its own out of
    // that set rather than asking for them by card.
    const boards_card_reactions = newCollection('boards_card_reactions', {
        omitOnInsert: ['created'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    const boards_lists = newCollection('boards_lists', {
        omitOnInsert: ['created', 'updated'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    const boards_labels = newCollection('boards_labels', {
        omitOnInsert: ['created', 'updated'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // An epic chip renders on the card face and the epic manager lists every
    // epic, used or not, so the whole set rides with the project rather than
    // being expanded per card.
    const boards_epics = newCollection('boards_epics', {
        omitOnInsert: ['created', 'updated'] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // Sprints, for the reason epics are: a sprint chip renders on the card
    // face, the header scopes the board to the active sprint and the backlog
    // lists planned sprints with no cards yet.
    //
    // The omitted columns are all server-owned: `number` is allocated by
    // server/sprint_number.go, the rollup by sprint_rollup.go, and the
    // lifecycle stamps by the start/complete transitions. A client insert
    // never carries any of them (sprint_owned_columns.go would zero them
    // anyway).
    const boards_sprints = newCollection('boards_sprints', {
        omitOnInsert: [
            'created',
            'updated',
            'number',
            'started_at',
            'completed_at',
            'card_total',
            'card_done',
            'points_total',
            'points_done',
            'committed_count',
            'committed_points',
            'completed_count',
            'completed_points',
            'rolled_count',
        ] as const,
        syncMode: 'on-demand' as const,
        collectionOptions: indexed,
    })

    // A board's cards load with the project (`boards_cards_via_project`); a
    // card's children load with the card, through the relations below.
    //
    // No relation entry for `assignees` or `labels`: both are multi-relations
    // (`string[]`), which have no `eq()` correlation an include could use, and
    // both targets are already in the store (users eagerly, labels with the
    // board), so lib/board-project.ts resolves them by id.
    //
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
            // Server-owned like number/archived_at above: the GitHub webhook
            // (server/github_links.go) computes these from the card's linked
            // PRs, and neither has a "none" value to write explicitly — a new
            // card simply has no rows to roll up yet.
            'pr_state',
            'pr_review_state',
        ] as const,
        syncMode: 'on-demand' as const,
        relations: {
            boards_checklist_items_via_card: boards_checklist_items,
            boards_comments_via_card: boards_comments,
            boards_attachments_via_card: boards_attachments,
            boards_activity_via_card: boards_activity,
            boards_card_watchers_via_card: boards_card_watchers,
            boards_comment_reactions_via_card: boards_comment_reactions,
            boards_card_links_via_source: boards_card_links,
            boards_card_links_via_target: boards_card_links,
            boards_pr_links_via_card: boards_pr_links,
        },
        collectionOptions: indexed,
    })

    // `next_number` is the card-number allocator's state (see
    // server/card_number.go) — server-owned, never written by a client, and
    // absent from a new board's insert so it starts at the column default.
    // `slug` is NOT omitted: it is the one half of a card key a person chooses,
    // and the New board dialog sends it.
    //
    // On demand like its children: the sidebar's board list reaches project
    // rows by id through the membership join (served from the store or
    // fetched in one batch), and the board screen reads one project through
    // the back-relations below.
    const boards_projects = newCollection('boards_projects', {
        omitOnInsert: ['created', 'updated', 'next_number', 'next_sprint_number'] as const,
        syncMode: 'on-demand' as const,
        relations: {
            boards_lists_via_project: boards_lists,
            boards_labels_via_project: boards_labels,
            boards_epics_via_project: boards_epics,
            boards_sprints_via_project: boards_sprints,
            boards_cards_via_project: boards_cards,
            boards_card_reactions_via_project: boards_card_reactions,
        },
        collectionOptions: indexed,
    })

    // --- Small org-wide tables, eager.

    // Every membership the caller can read, whole: the sidebar lists boards
    // across the org from these rows, and the role check filters on project
    // AND user, which is not a subset a project fetch could prove complete.
    // `user` is a relation into core's eager `users` store; the roster reads
    // names through a join there. Rows carry no expand.
    const boards_project_members = newCollection('boards_project_members', {
        omitOnInsert: ['created', 'updated'] as const,
        relations: { project: boards_projects, user: coreStores.users },
        collectionOptions: indexed,
    })

    // Which repositories a board watches. Eager, like boards_project_members:
    // the GitHub settings screen (settings/github.tsx) lists every attached
    // repo across every board the user belongs to in one screen, not one
    // board's cards at a time. Rows are owner-managed and few per board.
    const boards_project_repos = newCollection('boards_project_repos', {
        omitOnInsert: ['created', 'updated'] as const,
        collectionOptions: indexed,
    })

    // Owner-only by rule, so this syncs a handful of rows at most.
    const boards_share_links = newCollection('boards_share_links', {
        omitOnInsert: ['created', 'updated'] as const,
        collectionOptions: indexed,
    })

    return {
        boards_activity,
        boards_card_links,
        boards_pr_links,
        boards_card_watchers,
        boards_comment_reactions,
        boards_card_reactions,
        boards_projects,
        boards_project_members,
        boards_project_repos,
        boards_share_links,
        boards_labels,
        boards_epics,
        boards_sprints,
        boards_sprint_snapshots,
        boards_lists,
        boards_cards,
        boards_checklist_items,
        boards_comments,
        boards_attachments,
    }
}
