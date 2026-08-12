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

    // `useReportIssue` returns null when a package declares no repository.url,
    // and every caller gates the Help menu's "Report an issue" item on that
    // return being non-null. So an absent url is not cosmetic metadata — it
    // removes the affordance outright, silently, which is exactly how cards
    // ended up the only member without one.
    it('contributes the due-date event source to the calendar', () => {
        // The module subpath must stay in step with package.json's
        // "./calendar-source" export — the generated config imports
        // '@tinycld/cards/calendar-source' from this entry.
        expect(manifest.eventSources).toEqual([
            {
                target: 'calendar',
                id: 'cards-due',
                label: 'Card due dates',
                module: 'calendar-source',
                color: 'graphite',
            },
        ])
    })

    it('declares the repository the Help menu reports issues against', () => {
        expect(manifest.repository?.url).toBe('https://github.com/tinycld/cards')
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
