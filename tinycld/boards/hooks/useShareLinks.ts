import { eq } from '@tanstack/db'
import { useQueryClient } from '@tanstack/react-query'
import { captureException } from '@tinycld/core/lib/errors'
import { useMutation } from '@tinycld/core/lib/mutations'
import { pb, useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useMemo } from 'react'
import type { BoardsShareLinkRole } from '../types'

/**
 * Share links for one board.
 *
 * READS go through the collection like everything else — boards_share_links is
 * owner-only by rule, so it syncs a handful of rows and stays live for free.
 *
 * WRITES go through `pb.send`, which is the one place cards sets the
 * never-bypass-pbtsdb rule aside, for the reason the rule contemplates: the
 * token is 32 bytes of server entropy a client must not choose, and minting
 * also flips `boards_projects.visibility`, which a client insert cannot do
 * atomically. Both endpoints re-check ownership server-side; the affordance
 * gating in the dialog is convenience, not enforcement.
 */

export interface ShareLinkRow {
    id: string
    token: string
    role: BoardsShareLinkRole
    /** Empty means the link never expires. */
    expiresAt: string
    isActive: boolean
    created: string
}

interface ShareLinkPayload {
    id: string
    token: string
    role: BoardsShareLinkRole
    expires_at: string
    is_active: boolean
    created: string
}

/** Durations the mint endpoint accepts. 0 is "never". */
export type ShareLinkExpiryDays = 0 | 7 | 30 | 90

/**
 * Seven days, matching the server's own default.
 *
 * Drive mints links that never expire. A board is a larger surface than a
 * single file — a write link is an unbounded invitation — so cards defaults
 * short and makes "never" a deliberate choice rather than the path of least
 * resistance.
 */
export const DEFAULT_SHARE_LINK_EXPIRY_DAYS: ShareLinkExpiryDays = 7

export const SHARE_LINK_EXPIRY_OPTIONS: { value: ShareLinkExpiryDays; label: string }[] = [
    { value: 7, label: '7 days' },
    { value: 30, label: '30 days' },
    { value: 90, label: '90 days' },
    { value: 0, label: 'Never' },
]

/** Live share links for a board, newest first. Empty for a non-owner. */
export function useShareLinks(projectId: string) {
    const [linksCollection] = useStore('boards_share_links')

    const { data } = useOrgLiveQuery(
        query =>
            projectId
                ? query
                      .from({ link: linksCollection })
                      .where(({ link }) => eq(link.project, projectId))
                : undefined,
        [projectId, linksCollection]
    )

    const links = useMemo<ShareLinkRow[]>(() => {
        const rows = (data ?? []).map(link => ({
            id: link.id,
            token: link.token,
            role: link.role,
            expiresAt: link.expires_at ?? '',
            isActive: !!link.is_active,
            created: link.created ?? '',
        }))
        return rows.sort((a, b) => b.created.localeCompare(a.created))
    }, [data])

    // What the dialog's summary line keys off. A link that has expired is not
    // live even though its row still says active — the rule checks both, and a
    // badge that disagrees with the rule is worse than no badge.
    const activeLink = useMemo(
        () => links.find(link => link.isActive && !isExpired(link.expiresAt)),
        [links]
    )

    return { links, activeLink }
}

/** Whether an `expires_at` has passed. An empty value never expires. */
export function isExpired(expiresAt: string): boolean {
    if (!expiresAt) return false
    const parsed = Date.parse(expiresAt.replace(' ', 'T'))
    return Number.isFinite(parsed) && parsed < Date.now()
}

export interface CreateShareLinkInput {
    role: BoardsShareLinkRole
    expiresInDays: ShareLinkExpiryDays
}

export function useCreateShareLink(projectId: string) {
    const queryClient = useQueryClient()

    return useMutation<ShareLinkRow, Error, CreateShareLinkInput>({
        mutationKey: ['boards', 'share-link', 'create', projectId],
        mutationFn: async ({ role, expiresInDays }: CreateShareLinkInput) => {
            try {
                const payload = await pb.send<ShareLinkPayload>('/api/boards/share-link', {
                    method: 'POST',
                    body: {
                        project_id: projectId,
                        role,
                        expires_in_days: expiresInDays,
                    },
                })
                return toShareLinkRow(payload)
            } catch (err) {
                captureException('boards.shareLink.create', err, { projectId, role })
                throw err
            }
        },
        // The collection is live, so the new row arrives on its own; this only
        // covers the realtime round-trip so the dialog does not look inert for
        // a beat after a press.
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['boards_share_links'] }),
    })
}

export function useRevokeShareLink(projectId: string) {
    const queryClient = useQueryClient()

    return useMutation<void, Error, string>({
        mutationKey: ['boards', 'share-link', 'revoke', projectId],
        mutationFn: async (linkId: string) => {
            try {
                await pb.send(`/api/boards/share-link/${linkId}`, { method: 'DELETE' })
            } catch (err) {
                captureException('boards.shareLink.revoke', err, { projectId, linkId })
                throw err
            }
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['boards_share_links'] }),
    })
}

function toShareLinkRow(payload: ShareLinkPayload): ShareLinkRow {
    return {
        id: payload.id,
        token: payload.token,
        role: payload.role,
        expiresAt: payload.expires_at ?? '',
        isActive: !!payload.is_active,
        created: payload.created ?? '',
    }
}
