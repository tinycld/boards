import { setResolvedAddress } from '@tinycld/core/lib/server-address'
import { beforeAll, describe, expect, it } from 'vitest'
import {
    embedSnippet,
    embedSummary,
    shareLinkURL,
} from '~/tinycld/boards/components/sharing/ShareLinkSection'

/**
 * The iframe an owner pastes into another page.
 *
 * Small, but it is one half of a contract whose other half is in Go:
 * `embedTokenFromRequest` (server/embed.go) only grants framing to
 * `/p/boards/<token>?embed=1`, and the public screen only drops its chrome for
 * the same parameter. A snippet that omitted it would produce an iframe the
 * browser refuses to render — and the owner would have no way to tell why.
 */
describe('embedSnippet', () => {
    const token = 'a'.repeat(64)

    // The real resolver, not a mock: off web, shareLinkURL builds on the
    // configured server address, and that gate is exactly what these URLs
    // depend on.
    beforeAll(() => setResolvedAddress('https://team.tinycld.org'))

    it('points at the share route with the embed parameter', () => {
        const snippet = embedSnippet(token)
        expect(snippet).toContain(`${shareLinkURL(token)}?embed=1`)
    })

    it('is a complete iframe element', () => {
        const snippet = embedSnippet(token)
        expect(snippet.startsWith('<iframe ')).toBe(true)
        expect(snippet.endsWith('</iframe>')).toBe(true)
        expect(snippet).toContain('title="Board"')
    })

    it('quotes the src so a token cannot break out of the attribute', () => {
        // The token is server-minted hex, so this is belt and braces rather
        // than a live risk — but the snippet is HTML an owner pastes into a
        // page they control, and an unquoted src is how that stops being true.
        expect(embedSnippet(token)).toContain(`src="`)
    })
})

/**
 * The line the share dialog shows about an existing link's embed policy.
 *
 * It is the only place an owner can see where their board is currently
 * framable, and the bug this feature fixes is precisely someone believing a
 * board was embeddable somewhere it was not. "Not embedded" has to be stated
 * rather than left as a blank line.
 */
describe('embedSummary', () => {
    const link = (embedDomains: string, embedLive = false) => ({
        id: 'l1',
        token: 'a'.repeat(64),
        role: 'viewer' as const,
        expiresAt: '',
        isActive: true,
        created: '',
        embedDomains,
        embedLive,
    })

    it('says so plainly when the link may not be framed anywhere', () => {
        expect(embedSummary(link(''))).toBe('Not embedded on any website')
    })

    it('names the origin a board is framable at', () => {
        expect(embedSummary(link('https://example.com'))).toContain('https://example.com')
    })

    it('separates several origins readably', () => {
        // Stored space-separated for the CSP header; shown comma-separated,
        // because a run of URLs split only by spaces is unreadable.
        expect(embedSummary(link('https://a.example.com https://b.example.com'))).toBe(
            'Embeddable on https://a.example.com, https://b.example.com'
        )
    })

    it('marks a live embed, which is the one that costs a connection', () => {
        expect(embedSummary(link('https://example.com', true))).toContain('live')
        expect(embedSummary(link('https://example.com', false))).not.toContain('live')
    })
})
