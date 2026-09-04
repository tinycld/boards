import type { BoardsMemberRole } from '../types'

/**
 * The client half of the access rules — the ONLY place a role is interpreted.
 *
 * Each capability mirrors one rule fragment from
 * pb-migrations/1980000000_create_cards_collections.js (~L804-813); review the
 * two lists together whenever either changes:
 *
 *   canEdit    ← viaWriter    (owner | editor)
 *   canComment ← viaCommenter (owner | editor | commentor)
 *   isOwner    ← viaOwner     (owner)
 *
 * The granting roles are NAMED, never derived by exclusion: `role !== 'viewer'`
 * is how drive silently granted commentor UPDATE, and a future read-only role
 * must not inherit write access by accident.
 */
export interface ProjectCapabilities {
    canEdit: boolean
    canComment: boolean
    isOwner: boolean
}

export function capabilitiesFor(role: BoardsMemberRole | null): ProjectCapabilities {
    return {
        canEdit: role === 'owner' || role === 'editor',
        canComment: role === 'owner' || role === 'editor' || role === 'commentor',
        isOwner: role === 'owner',
    }
}

/**
 * What the Share dialog may offer on one member row.
 *
 * This is the client last-owner guard: a PB rule sees one row and cannot count
 * owners, so the sole owner's demote/remove/leave affordances must never
 * render. server/member_owner_guard.go enforces the same invariant at the API.
 * Neither is redundant — the hook cannot explain a refusal inside a dialog, and
 * this derivation cannot bind a caller who never opens one. Do not "simplify"
 * either away.
 */
export interface MemberRowActions {
    /** Caller is an owner and the row is not the last owner. */
    canChangeRole: boolean
    /** Caller is an owner removing a row that is not the last owner. */
    canRemove: boolean
    /** The caller's own row, unless they are the last owner. */
    canLeave: boolean
    isLastOwner: boolean
}

export function memberRowActionsFor(input: {
    rowRole: BoardsMemberRole
    rowUserId: string
    currentUserId: string
    callerIsOwner: boolean
    ownerCount: number
}): MemberRowActions {
    const isLastOwner = input.rowRole === 'owner' && input.ownerCount === 1
    const isOwnRow = input.rowUserId === input.currentUserId
    return {
        canChangeRole: input.callerIsOwner && !isLastOwner,
        canRemove: input.callerIsOwner && !isOwnRow && !isLastOwner,
        canLeave: isOwnRow && !isLastOwner,
        isLastOwner,
    }
}
