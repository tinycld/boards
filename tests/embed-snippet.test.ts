import { setResolvedAddress } from '@tinycld/core/lib/server-address'
import { beforeAll, describe, expect, it } from 'vitest'
import { embedSnippet, shareLinkURL } from '~/tinycld/boards/components/sharing/ShareLinkSection'

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
