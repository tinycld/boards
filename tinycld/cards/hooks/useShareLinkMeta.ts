import { useQuery } from '@tanstack/react-query'
import { PB_SERVER_ADDR } from '@tinycld/core/lib/pocketbase'
import type { PublicBoardGoneReason } from '../lib/public-board-routing'

/**
 * What a share-link token resolves to, read from the PUBLIC metadata endpoint.
 *
 * This is the only thing that can answer "which board is this token for, and
 * what does it offer me?" for the caller who needs the answer.
 * `cards_share_links` is owner-only by rule, so a visitor reads no row from it:
 * any client-side query resolves correctly only for people who already have
 * access, i.e. nobody who arrived by link. That mistake shipped once already —
 * it is what made the sign-in button appear exclusively for board owners.
 *
 * The endpoint discloses strictly less than the link itself does: the board's
 * name and id, which the visitor is about to read anyway, and the role, which
 * is what the link grants them. Nothing about the roster, the owner, or any
 * other link.
 *
 * `GET /api/cards/share-link/<token>` answers:
 *   200 — live link: `{ role, project_id, project_name, needs_signin }`
 *   410 — `is_active = false` (revoked) or past `expires_at` (expired)
 *   404 — no such token, or the board it named is gone
 */

/** The roles that make a sign-in worth offering. A viewer link offers none. */
export type ShareLinkSignInRole = 'commentor' | 'editor'

export interface ShareLinkMeta {
    /** The board the token names. Empty until resolved, or when rejected. */
    projectId: string
    projectName: string
    /** Non-null only when signing in would actually gain the visitor something. */
    signInRole: ShareLinkSignInRole | null
    /** The server refused the token: revoked, expired, or never real. */
    isRejected: boolean
    /**
     * Why it was refused, for the message the visitor reads. `revoked` and
     * `expired` are different facts and the person who shared the board can act
     * on them differently, so the endpoint's 410 body is not flattened here.
     */
    rejectionReason: PublicBoardGoneReason
    /** The fetch has settled, one way or the other. */
    isResolved: boolean
}

export interface ShareLinkMetaPayload {
    role?: string
    project_id?: string
    project_name?: string
    needs_signin?: boolean
}

/** The shapes the endpoint can settle into. `null` means the fetch failed. */
export type ShareLinkMetaResult =
    | { ok: true; payload: ShareLinkMetaPayload }
    | { ok: false; reason: PublicBoardGoneReason }

/**
 * Map an HTTP status and error body onto a refusal reason.
 *
 * Pure and separately tested, because it is the seam where the server's
 * vocabulary becomes the visitor's. The endpoint answers 410 for BOTH a revoked
 * and an expired link and separates them only in the message text, so this is
 * the single place that distinction survives or is lost.
 */
export function toRejectionReason(
    status: number,
    error: string | undefined
): PublicBoardGoneReason {
    if (status !== 410) return 'missing'
    return error?.includes('expired') ? 'expired' : 'revoked'
}

export function useShareLinkMeta(token: string): ShareLinkMeta {
    const { data, isPending } = useQuery<ShareLinkMetaResult | null>({
        queryKey: ['cards', 'share-link-meta', token],
        enabled: !!token,
        // A token's liveness is the server's to decide on every request — the
        // access rules re-read `is_active` and `expires_at` each time. Refetching
        // on focus keeps a revoked link from continuing to look live in a tab
        // that has been sitting open.
        refetchOnWindowFocus: true,
        queryFn: async () => {
            const res = await fetch(
                `${PB_SERVER_ADDR}/api/cards/share-link/${encodeURIComponent(token)}`
            )
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { error?: string } | null
                return { ok: false, reason: toRejectionReason(res.status, body?.error) } as const
            }
            return { ok: true, payload: (await res.json()) as ShareLinkMetaPayload } as const
        },
    })

    // A network failure is NOT a rejection. Reporting one as a dead link would
    // tell the visitor to go ask for a new link over a dropped connection; the
    // board query below fails visibly on its own.
    if (!token) {
        return emptyMeta({ isRejected: true, isResolved: true })
    }
    if (isPending || !data) {
        return emptyMeta({ isResolved: false })
    }
    if (!data.ok) {
        return emptyMeta({ isRejected: true, rejectionReason: data.reason, isResolved: true })
    }

    const { payload } = data
    return {
        projectId: payload.project_id ?? '',
        projectName: payload.project_name ?? '',
        signInRole: toSignInRole(payload),
        isRejected: false,
        rejectionReason: 'missing',
        isResolved: true,
    }
}

/**
 * A viewer link returns `needs_signin: false` and offers no role, matching the
 * server: anonymous read is its whole grant and the OTP endpoints refuse it
 * outright. An unrecognised role is treated as offering nothing rather than
 * coerced, the same discipline the mint endpoint applies.
 */
export function toSignInRole(payload: ShareLinkMetaPayload): ShareLinkSignInRole | null {
    if (!payload.needs_signin) return null
    return payload.role === 'editor' || payload.role === 'commentor' ? payload.role : null
}

function emptyMeta(overrides: Partial<ShareLinkMeta>): ShareLinkMeta {
    return {
        projectId: '',
        projectName: '',
        signInRole: null,
        isRejected: false,
        rejectionReason: 'missing',
        isResolved: false,
        ...overrides,
    }
}
