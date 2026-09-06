import { describe, expect, it } from 'vitest'
import { agingLevel } from '../tinycld/boards/lib/aging'
import type { ListCategory } from '../tinycld/boards/lib/list-category'

// Aging's contract: the level is a function of how long the card has sat in its
// CURRENT column, and four separate conditions all mean "do not tint".
//
// `now` is a parameter rather than read from the clock, so these are
// deterministic — the pattern lib/sprint.ts and lib/due-time.ts already use.

const NOW = new Date('2026-09-05T12:00:00.000Z')

/** A stamp `days` before NOW, in the shape PocketBase stores. */
function daysAgo(days: number): string {
    return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ')
}

const level = (stamp: string, threshold: number, category: ListCategory = 'in_progress') =>
    agingLevel(stamp, threshold, category, NOW)

describe('agingLevel', () => {
    it('is fresh below the threshold', () => {
        expect(level(daysAgo(0), 7)).toBe('fresh')
        expect(level(daysAgo(6), 7)).toBe('fresh')
    })

    it('is warm from the threshold, and stale from twice it', () => {
        expect(level(daysAgo(7), 7)).toBe('warm')
        expect(level(daysAgo(13), 7)).toBe('warm')
        expect(level(daysAgo(14), 7)).toBe('stale')
        expect(level(daysAgo(90), 7)).toBe('stale')
    })

    // The off switch, and the default for every board that predates the column.
    it('never tints when the threshold is zero', () => {
        expect(level(daysAgo(365), 0)).toBe('fresh')
    })

    it('never tints on a negative threshold either', () => {
        expect(level(daysAgo(365), -1)).toBe('fresh')
    })

    // Work in a closed list has finished. Amber on a finished card says the
    // opposite of the truth, however long it has been sitting there.
    it('never tints a card in a done or canceled list', () => {
        expect(level(daysAgo(365), 7, 'done')).toBe('fresh')
        expect(level(daysAgo(365), 7, 'canceled')).toBe('fresh')
    })

    it('still tints the open categories', () => {
        for (const category of ['backlog', 'todo', 'in_progress'] as ListCategory[]) {
            expect(level(daysAgo(30), 7, category)).toBe('stale')
        }
    })

    // A card the server has not echoed yet carries ''. A missing timestamp is
    // not an old one — parsing it would age a card created a moment ago to the
    // epoch and tint it on sight.
    it('treats an empty stamp as fresh, not as the epoch', () => {
        expect(level('', 7)).toBe('fresh')
    })

    it('treats an unparseable stamp as fresh', () => {
        expect(level('not a date', 7)).toBe('fresh')
    })

    // A clock skew, or a stamp written a moment in the future, must not wrap
    // around into "stale".
    it('is fresh for a stamp in the future', () => {
        expect(level(daysAgo(-3), 7)).toBe('fresh')
    })

    it('reads the ISO "T" form as well as PocketBase’s space form', () => {
        const iso = new Date(NOW.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString()
        expect(level(iso, 7)).toBe('stale')
    })

    // Elapsed time, not calendar days — the same cutoff arithmetic
    // server/auto_archive.go uses, so the two settings agree about one card.
    it('counts elapsed 24h periods rather than calendar days', () => {
        const justUnder = new Date(NOW.getTime() - (7 * 24 - 1) * 60 * 60 * 1000).toISOString()
        expect(level(justUnder, 7)).toBe('fresh')
        const justOver = new Date(NOW.getTime() - (7 * 24 + 1) * 60 * 60 * 1000).toISOString()
        expect(level(justOver, 7)).toBe('warm')
    })
})
