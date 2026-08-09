import { describe, expect, it } from 'vitest'
import { toRejectionReason, toSignInRole } from '~/tinycld/cards/hooks/useShareLinkMeta'

// The two pure seams of useShareLinkMeta, where the metadata endpoint's answer
// becomes what the visitor sees.
//
// These matter more than their size suggests. cards_share_links is owner-only
// by rule, so this endpoint is the ONLY thing that can tell a link-holder which
// board they are looking at and what their link offers — a client-side query
// resolves correctly only for people who already have access, which is nobody
// who arrived by link. That mistake already shipped once, as a sign-in button
// visible exclusively to board owners.

describe('toRejectionReason', () => {
    it('reads a revoked link off the 410 body', () => {
        expect(toRejectionReason(410, 'this link has been revoked')).toBe('revoked')
    })

    it('reads an expired link off the 410 body', () => {
        // The server answers 410 for BOTH revoked and expired and separates
        // them only in the message, so this is the single place the difference
        // survives. Collapsing it would tell someone whose link merely lapsed
        // that an owner switched it off.
        expect(toRejectionReason(410, 'this link has expired')).toBe('expired')
    })

    it('treats a 404 as missing regardless of the body', () => {
        expect(toRejectionReason(404, 'share link not found')).toBe('missing')
        expect(toRejectionReason(404, 'board not found')).toBe('missing')
    })

    it('defaults a 410 with no readable body to revoked', () => {
        // `revoked` is the safe default of the two: its message sends the
        // visitor to ask for a new link, which is right either way.
        expect(toRejectionReason(410, undefined)).toBe('revoked')
    })

    it('treats any other refusal as missing', () => {
        // 429 from the rate limiter, or a 500. Neither means the link is dead,
        // but neither resolves a board either, and "could not be found" is the
        // honest thing to say without inventing a cause.
        expect(toRejectionReason(429, 'rate limit exceeded')).toBe('missing')
        expect(toRejectionReason(500, undefined)).toBe('missing')
    })
})

describe('toSignInRole', () => {
    it('offers an editor sign-in', () => {
        expect(toSignInRole({ role: 'editor', needs_signin: true })).toBe('editor')
    })

    it('offers a commentor sign-in', () => {
        expect(toSignInRole({ role: 'commentor', needs_signin: true })).toBe('commentor')
    })

    it('offers nothing on a viewer link', () => {
        // Anonymous read is a viewer link's whole grant, so an account would
        // buy the visitor nothing and cost them an email address. The OTP
        // endpoints refuse it outright; this is the affordance agreeing.
        expect(toSignInRole({ role: 'viewer', needs_signin: false })).toBeNull()
    })

    it('trusts needs_signin over the role', () => {
        // The server decides which roles imply contributing. If it says no,
        // the button does not appear whatever the role reads.
        expect(toSignInRole({ role: 'editor', needs_signin: false })).toBeNull()
    })

    it('offers nothing for an unrecognised role', () => {
        // Not coerced to commentor. An unknown role means client and server
        // disagree about the vocabulary, and guessing low is still guessing —
        // the same discipline the mint endpoint applies by refusing outright.
        expect(toSignInRole({ role: 'owner', needs_signin: true })).toBeNull()
        expect(toSignInRole({ role: '', needs_signin: true })).toBeNull()
        expect(toSignInRole({ needs_signin: true })).toBeNull()
    })
})
