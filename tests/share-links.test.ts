import { describe, expect, it } from 'vitest'
import { ROLE_OPTIONS, SHARE_LINK_ROLE_OPTIONS } from '~/tinycld/cards/components/sharing/roles'
import {
    DEFAULT_SHARE_LINK_EXPIRY_DAYS,
    isExpired,
    SHARE_LINK_EXPIRY_OPTIONS,
} from '~/tinycld/cards/hooks/useShareLinks'

describe('SHARE_LINK_ROLE_OPTIONS', () => {
    it('offers every role a link may grant', () => {
        // The anti-drive-gap assertion, and it has to be a test rather than a
        // comment. Drive's dialog can only mint VIEWER links — its own option
        // list omits commentor and both creation sites hardcode viewer — which
        // makes drive's entire email-OTP sign-in flow unreachable from drive's
        // own UI, since a viewer link is precisely the one that flow refuses.
        // Cards must be able to mint all three.
        expect(SHARE_LINK_ROLE_OPTIONS.map(o => o.value)).toEqual(['editor', 'commentor', 'viewer'])
    })

    it('never offers owner', () => {
        // cards_share_links.role's enum has no owner value: a link must never
        // confer ownership of a board. The server rejects it too.
        expect(SHARE_LINK_ROLE_OPTIONS.some(o => o.value === 'owner')).toBe(false)
    })

    it('derives from the roster options rather than restating them', () => {
        // The point of deriving: a role added to ROLE_OPTIONS shows up here
        // automatically instead of being silently missing.
        expect(SHARE_LINK_ROLE_OPTIONS).toHaveLength(ROLE_OPTIONS.length - 1)
        for (const option of SHARE_LINK_ROLE_OPTIONS) {
            expect(ROLE_OPTIONS).toContainEqual(option)
        }
    })
})

describe('SHARE_LINK_EXPIRY_OPTIONS', () => {
    it('defaults to seven days', () => {
        // Drive mints links that never expire. A board is a bigger surface
        // than one file, so cards defaults short and makes never explicit.
        expect(DEFAULT_SHARE_LINK_EXPIRY_DAYS).toBe(7)
        expect(SHARE_LINK_EXPIRY_OPTIONS[0]?.value).toBe(7)
    })

    it('offers never as an explicit choice, last', () => {
        expect(SHARE_LINK_EXPIRY_OPTIONS.at(-1)).toEqual({ value: 0, label: 'Never' })
    })

    it('offers only durations the server accepts', () => {
        // The server validates against a closed set and 400s on anything else,
        // so an option the endpoint refuses would be a button that cannot work.
        expect(SHARE_LINK_EXPIRY_OPTIONS.map(o => o.value)).toEqual([7, 30, 90, 0])
    })
})

describe('isExpired', () => {
    it('treats an empty value as never expiring', () => {
        // "" is what the column stores for a never-expiring link, and the
        // matching branch of the access rule is `expires_at ?= ""`.
        expect(isExpired('')).toBe(false)
    })

    it('reads a past date as expired', () => {
        expect(isExpired('2020-01-01 00:00:00.000Z')).toBe(true)
    })

    it('reads a future date as live', () => {
        expect(isExpired('2999-01-01 00:00:00.000Z')).toBe(false)
    })

    it("parses PocketBase's space-separated format", () => {
        // PB stores `YYYY-MM-DD HH:MM:SS.sssZ`, which Date.parse does not
        // reliably accept until the space becomes a T. Without the swap every
        // date reads as NaN and therefore as live — a revoked-looking link that
        // silently still works.
        const past = new Date(Date.now() - 60_000).toISOString().replace('T', ' ').replace('Z', 'Z')
        expect(isExpired(past)).toBe(true)
    })

    it('treats an unparseable value as live rather than expired', () => {
        // Fail open on garbage: the ACCESS decision is the server's, and the
        // rule would refuse a bad date anyway. Hiding a link the server still
        // honours would be the more confusing failure.
        expect(isExpired('not-a-date')).toBe(false)
    })
})
