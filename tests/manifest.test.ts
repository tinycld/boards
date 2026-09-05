import { describe, expect, it } from 'vitest'
import manifest from '../manifest'

describe('boards manifest', () => {
    it('declares required identifiers', () => {
        expect(manifest.name).toBe('Boards')
        expect(manifest.slug).toBe('boards')
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
    // removes the affordance outright, silently, which is exactly how boards
    // ended up the only member without one.
    it('contributes the due-date event source to the calendar', () => {
        // The module subpath must stay in step with package.json's
        // "./calendar-source" export — the generated config imports
        // '@tinycld/boards/calendar-source' from this entry.
        expect(manifest.eventSources).toEqual([
            {
                target: 'calendar',
                id: 'boards-due',
                label: 'Card due dates',
                module: 'calendar-source',
                color: 'graphite',
            },
            // Sprint dates ride as a second source with its own toggle, and
            // its module must likewise stay in step with the exports map.
            {
                target: 'calendar',
                id: 'boards-sprints',
                label: 'Sprint dates',
                module: 'calendar-sprint-source',
                color: 'graphite',
            },
        ])
    })

    it('declares the repository the Help menu reports issues against', () => {
        expect(manifest.repository?.url).toBe('https://github.com/tinycld/boards')
    })

    it('declares the CLI module gen-cli.ts compiles into the binary', () => {
        expect(manifest.cli?.package).toBe('cli')
        expect(manifest.cli?.module).toBe('tinycld.org/packages/boards/cli')
    })

    // The CLI holds boards:read and boards:write, and NOTHING ELSE. Both halves
    // matter. A missing scope 403s every command against a real server while
    // the Go suite — which runs no scope middleware — stays green. An extra
    // scope silently widens what a boards grant can reach on the consent
    // screen, which is the kind of change that should never arrive as a side
    // effect of editing a manifest.
    //
    // Note what these scopes deliberately do NOT buy: boards_project_members
    // and boards_share_links are registered READ-ONLY for OAuth callers in
    // core's collectionScopes, so boards:write cannot add a member or mint a
    // public share link. That asymmetry is asserted on the core side in
    // route_classification_test.go.
    it('requests exactly the boards scopes', () => {
        expect(manifest.cli?.scopes).toEqual(['boards:read', 'boards:write'])
    })
})
