import { appHref } from '@tinycld/core/lib/org-routes'
/**
 * Where a visitor arriving on a board share link should end up.
 *
 * A PURE function with its own tests, deliberately. Drive learned this the hard
 * way: its equivalent decision lived inline in JSX, gated on a field the server
 * had stopped sending, and silently sent every signed-in member to the
 * anonymous preview of their own file. Nothing failed — it just quietly served
 * the wrong screen (see drive/tinycld/drive/lib/share-routing.ts's header).
 */

/**
 * Why a link cannot be opened. Three distinct facts, deliberately not collapsed
 * into one: an owner who revoked a link, a link that lapsed on its own, and a
 * URL that never named a board are different situations, and the person who
 * shared the board can act on each of them differently.
 */
export type PublicBoardGoneReason = 'revoked' | 'expired' | 'missing'

export type PublicBoardRoute =
    /** Still resolving auth or the board. Render a spinner, decide nothing. */
    | { kind: 'wait' }
    /** Send them into the workspace — they have real access. */
    | { kind: 'redirect'; href: string }
    /** Show the read-only public board. */
    | { kind: 'public' }
    /** The link is revoked, expired, or was never real. */
    | { kind: 'gone'; reason: PublicBoardGoneReason }

export interface PublicBoardRouteInput {
    /** Auth is still rehydrating; nothing below is trustworthy yet. */
    isAuthLoading: boolean
    /** Whether a real PocketBase session exists. */
    isSignedIn: boolean
    /** The board the token names, once the token has resolved. */
    projectId: string | undefined
    /** Whether the signed-in caller holds a membership on that board. */
    isMember: boolean
    /** Set once the board query has settled, member or not. */
    isBoardResolved: boolean
    /**
     * The SERVER refused the token. Not a client guess: a revoked, expired or
     * fabricated token is a perfectly well-formed string, so nothing about the
     * URL itself reveals this — only the metadata endpoint's 404/410 does.
     */
    isTokenRejected: boolean
    /** Which refusal it was. Ignored unless `isTokenRejected`. */
    rejectionReason?: PublicBoardGoneReason
}

export function decidePublicBoardRoute(input: PublicBoardRouteInput): PublicBoardRoute {
    if (input.isAuthLoading) return { kind: 'wait' }

    // A rejected token is terminal regardless of who is asking: it is revoked,
    // expired, or fabricated. Checked BEFORE membership so a member following a
    // dead link is told the link is dead rather than being silently redirected
    // as if it had worked — they may well be the person who needs to re-issue
    // it.
    if (input.isTokenRejected) {
        return { kind: 'gone', reason: input.rejectionReason ?? 'revoked' }
    }

    if (!input.isBoardResolved) return { kind: 'wait' }

    if (!input.projectId) return { kind: 'gone', reason: 'missing' }

    // A signed-in MEMBER goes to the workspace.
    //
    // This is where cards diverges from drive, and on purpose. Drive keeps its
    // guests on the share route because a drive guest has access to exactly one
    // FILE — the workspace would 403 them everywhere else. A cards visitor who
    // has redeemed a link holds a real boards_project_members row on a whole
    // board, which is a first-class workspace object: they get the live,
    // writable board at their granted role, with drag, shortcuts and everything
    // else. The read-only public view would be a strictly worse rendering of
    // something they fully own.
    if (input.isSignedIn && input.isMember) {
        return { kind: 'redirect', href: appHref('boards') }
    }

    return { kind: 'public' }
}
