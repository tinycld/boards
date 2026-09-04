// Cards types, in two layers.
//
// LAYER 1 — record shapes, RE-EXPORTED FROM THE GENERATED SCHEMA.
//
// `pbSchema.ts` is generated on every install by replaying the on-disk
// migrations, so the interfaces below are derived from the migration rather
// than restated beside it. The select fields come out as real unions
// (`role: 'owner' | 'editor' | ...`) that cannot drift from the enum the
// database enforces.
//
// This is deliberately unlike the other packages, which hand-write their own
// record types and import only foreign ones. It is an experiment: a hand-written
// copy of the migration is the same failure mode core's `rlstest` exists to
// prevent for rules — a restatement cannot fail for the reason you wrote it.
// If this holds up, the other packages follow.
//
// Safe because `packages:generate` runs in the workspace-root postinstall,
// before any typecheck, so `cards_*` is always present in pbSchema by the time
// cards compiles. CI is likewise fine: it installs before it checks.
//
// THE ONE COST, and it is a local-loop cost only: pbSchema.ts is gitignored and
// derived from the on-disk migrations, so editing a migration without
// regenerating leaves it stale — and the error surfaces as "Property 'x' does
// not exist on type 'CardsCards'" in a file you did not touch, pointing at a
// type you did not write. When that happens the fix is never to edit a type:
//
//     cd ~/code/tinycld/tinycld && pnpm run packages:generate
//
// LAYER 2 — board view models, defined here.
//
// The nested, render-ready shapes the board query assembles from the flat
// records. See the block above them for why they are not just the records.

import type {
    CardsActivity,
    CardsAttachments,
    CardsCardLinks,
    CardsCards,
    CardsCardWatchers,
    CardsChecklistItems,
    CardsCommentReactions,
    CardsComments,
    CardsLabels,
    CardsLists,
    CardsProjectMembers,
    CardsProjects,
    CardsShareLinks,
    Users,
} from '@tinycld/core/types/pbSchema'
import type { ListCategory } from './lib/list-category'
import type { CardPriority } from './lib/priority'

export type {
    CardsActivity,
    CardsAttachments,
    CardsCardLinks,
    CardsCards,
    CardsCardWatchers,
    CardsChecklistItems,
    CardsCommentReactions,
    CardsComments,
    CardsLabels,
    CardsLists,
    CardsProjectMembers,
    CardsProjects,
    CardsShareLinks,
}

/**
 * A hex color string (`#8b5cf6`). Stored as free text rather than a select
 * enum so the palette can change without a migration, and so core's shared
 * ColorPickerGrid — which emits hex — can drive it directly.
 *
 * Not generated: the migration cannot express "text, but a hex color".
 */
export type CardsColor = string

/**
 * Drive's role vocabulary, verbatim, so a future extraction of the sharing
 * pattern into core has one vocabulary to work with.
 *
 * A `commentor` reads and comments but never edits. Access rules name the
 * writing roles explicitly rather than excluding `viewer`, so adding another
 * read-only role here cannot silently grant it write access.
 *
 * Aliased from the generated field so the name survives while the values stay
 * derived from the migration.
 */
export type CardsMemberRole = CardsProjectMembers['role']

/** A share link may grant read, comment or edit — never ownership. */
export type CardsShareLinkRole = CardsShareLinks['role']

/** `link` means the board is reachable by anyone holding a live share link. */
export type CardsProjectVisibility = CardsProjects['visibility']

/**
 * The five-step scale, re-exported from lib/priority.ts where its ORDER lives.
 * Not aliased from the generated field: the schema emits an optional select
 * with '' in its union, and '' is normalized away at the boundary (see
 * `normalizePriority`) so no component ever meets it.
 */
export type { CardPriority } from './lib/priority'

// ---------------------------------------------------------------------------
// Board view models
//
// The board query returns flat collections; these are what it assembles them
// into. They are deliberately NOT the record types:
//
//   - `due` is a Date or undefined, never PocketBase's ''. Keeping the ''
//     would push `card.due === ''` guards into four components and invite
//     `new Date('')` → Invalid Date.
//   - `labels` and `assignees` are resolved rows, not id arrays. An id array
//     is unrenderable; every consumer would otherwise repeat the same lookup.
//   - camelCase, because the components already are.
//
// Checklist items and comments are absent from BoardCardView on purpose: those
// collections sync on-demand and belong to the card-detail query, not the board
// tree. The board face reads the denormalized counters on the card instead.
// ---------------------------------------------------------------------------

export interface BoardMember {
    /** users.id */
    id: string
    firstName: string
    lastName: string
}

export interface BoardLabel {
    id: string
    name: string
    color: CardsColor
}

export interface BoardChecklistItem {
    id: string
    title: string
    isDone: boolean
    /** Fractional rank — see lib/rank.ts. Sort by `position, id`. */
    position: string
}

export interface BoardComment {
    id: string
    author: BoardMember
    /** ISO timestamp from `created`. Format at render, never store a string. */
    created: string
    /**
     * ISO timestamp of the last body edit, '' when never edited — what the
     * "(edited)" marker keys on. Server-owned (comment_edited.go stamps it
     * when the body actually changes); the update mutation also sets it
     * optimistically so the marker renders before the round trip completes.
     */
    editedAt: string
    body: string
    /** '' for a top-level comment; otherwise the comment being replied to. */
    parent: string
}

/** The history vocabulary — derived from the migration's select, never restated. */
export type ActivityKind = CardsActivity['kind']

export interface BoardActivity {
    id: string
    kind: ActivityKind
    /** Undefined for a write with no person behind it (a rule, a seed, the description flush). */
    actor?: BoardMember
    /** Raw values — ids, ISO dates, titles — resolved to names at render. */
    from: string
    to: string
    /** ISO timestamp from `created`. */
    created: string
}

export interface BoardAttachment {
    id: string
    /** PocketBase's stored name, `{name}_{random10}.{ext}` — what URLs use. */
    fileName: string
    /**
     * The user-editable `name` column when set (the upload writes the picked
     * file's original name; rename edits it), else the stored name with PB's
     * random suffix stripped — the fallback for pre-column rows.
     */
    displayName: string
    /** Bytes, written by the client on upload (PB stores no size of its own). */
    size: number
    /** Derived from the extension: PocketBase keeps no mime for a file field. */
    mimeType: string
    uploadedBy: BoardMember
    /** ISO timestamp from `created`. Format at render, never store a string. */
    created: string
}

export interface BoardCardView {
    id: string
    /**
     * The quotable identifier — `OTTER-123` — or '' when there isn't one yet.
     *
     * Precomputed here rather than formatted at each render site because the
     * slug half lives on the PROJECT, which a card node has no reference to.
     * '' covers both a board with no slug and a card the server has not
     * numbered (the optimistic-insert gap); see lib/card-key.ts.
     */
    key: string
    listId: string
    /** Fractional rank — see lib/rank.ts. Sort by `position, id`. */
    position: string
    title: string
    /** Markdown source. '' when unset. */
    description: string
    /** undefined when no due date is set. A local day, or an instant when `dueHasTime`. */
    due?: Date
    /** Whether `due` names a time as well as a day — see lib/due-time.ts. */
    dueHasTime: boolean
    /** undefined when no start date is set. Always a local day. */
    start?: Date
    labels: BoardLabel[]
    assignees: BoardMember[]
    /**
     * Who to ask about this card. Falls back to whoever created it, so this is
     * undefined only when the card has no creator either — the bootstrap-path
     * rows that store `created_by: ''` by convention.
     *
     * The optionality lives HERE rather than on `CardsCards.reporter`, which is
     * generated as a bare `string` ('' when unset) because the schema generator
     * ignores `required` for a maxSelect:1 relation.
     */
    reporter?: BoardMember
    /** Already normalized — never '' — see lib/priority.ts. */
    priority: CardPriority
    /** Points. Undefined when unset (the row stores 0) — see lib/estimate.ts. */
    estimate?: number
    /**
     * The status of the list the card sits in — what decides whether it is
     * "closed" for the due filters and My cards. Copied onto the card view
     * so those predicates need no list lookup.
     */
    listCategory: ListCategory
    /**
     * ISO timestamp from `created`, '' for an optimistic insert the server has
     * not echoed yet. What "sort by created" orders on; see lib/created-order.
     */
    created: string
    /** Denormalized counters, maintained by server/counters.go. */
    checklistTotal: number
    checklistDone: number
    commentCount: number
    attachmentCount: number
    /**
     * The card this one is a sub-task of, '' when it is top level.
     *
     * Always a card on the SAME board — pinned by the rule in migration
     * 1980000015 — so a resolver never has to look outside the loaded set.
     * A dangling id (the parent was deleted; the relation deliberately does
     * not cascade) reads as top level, the way comment threading treats a
     * missing parent.
     */
    parent: string
    /**
     * The parent's card key — `OTTER-4` — for the "↳ OTTER-4" chip on a
     * sub-task's face. '' when top level, when the board has no slug, and when
     * the parent has been deleted. Precomputed for the reason `key` is: a card
     * node carries no reference to the parent's row.
     */
    parentKey: string
    /**
     * The sub-task rollup, maintained by server/card_parent.go. `done` counts
     * children in a done or canceled list, so it agrees with the list header
     * glyph. Denormalized rather than counted from the loaded cards because a
     * card face renders where the board's card set is not loaded — My cards,
     * search results.
     */
    subtaskTotal: number
    subtaskDone: number
}

export interface BoardListView {
    id: string
    name: string
    /** Fractional rank — see lib/rank.ts. Sort by `position, id`. */
    position: string
    /** Already normalized — never '' — see lib/list-category.ts. */
    category: ListCategory
    /** The cards that pass the board filter, in the chosen sort order. */
    cards: BoardCardView[]
    /**
     * Every live card in the list, filtered or not. Differs from
     * `cards.length` only while a filter is on — that gap is what the column's
     * "3/12" count shows.
     */
    totalCount: number
}

/**
 * The {id, position} slice of a column that sibling-aware chrome (the column
 * menu's move left/right, the header drag's drop index, the add-list rank)
 * actually reads. Split from BoardListView so a card-level change — which
 * replaces that list's node and therefore `lists` — leaves this array's
 * identity untouched, keeping memoized columns from re-rendering.
 */
export interface BoardListRank {
    id: string
    position: string
}

export interface BoardProject {
    id: string
    name: string
    /**
     * The board's half of a card key (`OTTER`), or '' for a board created
     * without one. Uppercase alphanumeric and globally unique — see the
     * migration in pb-migrations/1980000004.
     */
    slug: string
    color: CardsColor
    /** Days a card sits in a done or canceled list before the server archives it; 0 = never. */
    autoArchiveDays: number
    members: BoardMember[]
    lists: BoardListView[]
    /** `lists` reduced to ranks — identity changes only when list ROWS change. */
    listOrder: BoardListRank[]
    /** Live cards across the whole board before the filter, for the header. */
    cardTotal: number
    /**
     * Every label defined on this board — what the card label picker offers,
     * which is a superset of any one card's `labels`.
     */
    labels: BoardLabel[]
    /**
     * Cards whose `list` names a row this client hasn't synced yet. Lists and
     * cards arrive on independent live queries, so a card can legitimately land
     * before its list does.
     *
     * They are held here rather than dropped: a dropped card is invisible AND
     * uncounted, which makes a list look empty enough to delete — and deleting
     * a list cascades its cards. Normally empty, and self-clearing once the
     * list row arrives.
     */
    unplacedCards: BoardCardView[]
}

/**
 * The relation map pbtsdb uses to type `expand`.
 *
 * The generator REQUIRES this export: `tinycld.config.ts` imports
 * `<Pascal>Schema` from every package's `./types` by name and feeds it to
 * `definePackageEntry<CardsSchema>()`. It is an ecosystem contract, not a local
 * convention — do not remove it.
 *
 * Aliased to the generated `Schema`, which already models every cards relation,
 * including the multi-relations as arrays (`assignees?: Users[]`) where the
 * hand-written map had them as scalars. The alias is wider than cards' own
 * collections, which is harmless: the config intersects each package's schema
 * anyway, so extra members change nothing.
 */
export type { Schema as CardsSchema } from '@tinycld/core/types/pbSchema'

// `Users` is re-exported for the view-model mapping in lib/board-project.ts.
export type { Users }
