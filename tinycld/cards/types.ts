// Record shapes for the cards collections, mirroring
// pb-migrations/1980000000_create_cards_collections.js.
//
// Only `Users` is imported from core's generated schema: a package must never
// import its OWN generated types, because those only exist once the package is
// installed and the lean shell has to typecheck without it.
//
// PocketBase never returns null or undefined for a declared field — an unset
// text, date or relation reads as ''. So optional columns are still typed as
// non-optional `string`, and emptiness is tested with `=== ''`.
import type { Users } from '@tinycld/core/types/pbSchema'

/**
 * A hex color string (`#8b5cf6`). Stored as free text rather than a select
 * enum so the palette can change without a migration, and so core's shared
 * ColorPickerGrid — which emits hex — can drive it directly.
 */
export type CardsColor = string

/**
 * Drive's role vocabulary, verbatim, so a future extraction of the sharing
 * pattern into core has one vocabulary to work with.
 *
 * A `commentor` reads and comments but never edits. Access rules name the
 * writing roles explicitly rather than excluding `viewer`, so adding another
 * read-only role here cannot silently grant it write access.
 */
export type CardsMemberRole = 'owner' | 'editor' | 'commentor' | 'viewer'

/** A share link may grant read, comment or edit — never ownership. */
export type CardsShareLinkRole = 'viewer' | 'commentor' | 'editor'

/** `link` means the board is reachable by anyone holding a live share link. */
export type CardsProjectVisibility = 'private' | 'link'

export interface CardsProjects {
    id: string
    name: string
    color: CardsColor
    visibility: CardsProjectVisibility
    created_by: string
    archived: boolean
    created: string
    updated: string
}

export interface CardsProjectMembers {
    id: string
    project: string
    user: string
    role: CardsMemberRole
    /** '' when the row was self-inserted as a project's first owner. */
    created_by: string
    created: string
    updated: string
}

export interface CardsShareLinks {
    id: string
    project: string
    /** 64 hex chars, minted server-side. */
    token: string
    role: CardsShareLinkRole
    created_by: string
    /** '' means the link never expires. */
    expires_at: string
    /** Revoking clears this; the token itself is retained and can be restored. */
    is_active: boolean
    created: string
    updated: string
}

export interface CardsLabels {
    id: string
    project: string
    name: string
    color: CardsColor
    created: string
    updated: string
}

export interface CardsLists {
    id: string
    project: string
    name: string
    /** Fractional rank — see lib/rank.ts. Sort by `position, id`. */
    position: string
    is_done: boolean
    created: string
    updated: string
}

export interface CardsCards {
    id: string
    /**
     * Denormalized from `list.project` so access rules resolve membership in one
     * hop. Always written together with `list` — nothing in the database keeps
     * the two in step.
     */
    project: string
    list: string
    /** Fractional rank — see lib/rank.ts. Sort by `position, id`. */
    position: string
    title: string
    /** Markdown source. '' when unset. */
    description: string
    /** ISO date string; '' when no due date is set. */
    due: string
    /** User ids. */
    assignees: string[]
    /** cards_labels ids. */
    labels: string[]
    created_by: string
    archived: boolean
    created: string
    updated: string
}

export interface CardsChecklistItems {
    id: string
    card: string
    project: string
    title: string
    is_done: boolean
    position: string
    created: string
    updated: string
}

export interface CardsComments {
    id: string
    card: string
    project: string
    author: string
    body: string
    /** '' for a top-level comment; otherwise the comment being replied to. */
    parent: string
    created: string
    updated: string
}

export interface CardsAttachments {
    id: string
    card: string
    project: string
    /** PB filename — build a fetchable URL with core's use-authed-file-url. */
    file: string
    size: number
    uploaded_by: string
    created: string
    updated: string
}

export type CardsSchema = {
    cards_projects: {
        type: CardsProjects
        relations: { created_by: Users }
    }
    cards_project_members: {
        type: CardsProjectMembers
        relations: { project: CardsProjects; user: Users; created_by: Users }
    }
    cards_share_links: {
        type: CardsShareLinks
        relations: { project: CardsProjects; created_by: Users }
    }
    cards_labels: {
        type: CardsLabels
        relations: { project: CardsProjects }
    }
    cards_lists: {
        type: CardsLists
        relations: { project: CardsProjects }
    }
    cards_cards: {
        type: CardsCards
        relations: {
            project: CardsProjects
            list: CardsLists
            assignees: Users
            labels: CardsLabels
            created_by: Users
        }
    }
    cards_checklist_items: {
        type: CardsChecklistItems
        relations: { card: CardsCards; project: CardsProjects }
    }
    cards_comments: {
        type: CardsComments
        relations: {
            card: CardsCards
            project: CardsProjects
            author: Users
            parent: CardsComments
        }
    }
    cards_attachments: {
        type: CardsAttachments
        relations: { card: CardsCards; project: CardsProjects; uploaded_by: Users }
    }
}
