import { describe, expect, it } from 'vitest'
import manifest from '../manifest'

describe('cards manifest', () => {
    it('declares required identifiers', () => {
        expect(manifest.name).toBe('Cards')
        expect(manifest.slug).toBe('cards')
        expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/)
    })

    it('has a description', () => {
        expect(manifest.description).toBe('Kanban boards for tracking work across lists.')
    })

    it('declares the seed script', () => {
        expect(manifest.seed?.script).toBe('seed')
    })

    it('declares the CLI module gen-cli.ts compiles into the binary', () => {
        expect(manifest.cli?.package).toBe('cli')
        expect(manifest.cli?.module).toBe('tinycld.org/packages/cards/cli')
    })

    // The CLI holds cards:read and cards:write, and NOTHING ELSE. Both halves
    // matter. A missing scope 403s every command against a real server while
    // the Go suite — which runs no scope middleware — stays green. An extra
    // scope silently widens what a cards grant can reach on the consent
    // screen, which is the kind of change that should never arrive as a side
    // effect of editing a manifest.
    //
    // Note what these scopes deliberately do NOT buy: cards_project_members
    // and cards_share_links are registered READ-ONLY for OAuth callers in
    // core's collectionScopes, so cards:write cannot add a member or mint a
    // public share link. That asymmetry is asserted on the core side in
    // route_classification_test.go.
    it('requests exactly the cards scopes', () => {
        expect(manifest.cli?.scopes).toEqual(['cards:read', 'cards:write'])
    })
})
