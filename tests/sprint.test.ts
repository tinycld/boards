import { describe, expect, it } from 'vitest'
import {
    compareSprints,
    DEFAULT_SPRINT_LENGTH_DAYS,
    daysRemaining,
    defaultSprintDates,
    formatSprintDates,
    normalizeSprintRollover,
    sprintLabel,
    sprintLengthDays,
    sprintProgress,
} from '../tinycld/boards/lib/sprint'
import type { BoardSprint } from '../tinycld/boards/types'

function sprint(overrides: Partial<BoardSprint> = {}): BoardSprint {
    return {
        id: 's1',
        number: 1,
        name: '',
        goal: '',
        state: 'planned',
        position: 'a0',
        startedAt: '',
        completedAt: '',
        cardTotal: 0,
        cardDone: 0,
        pointsTotal: 0,
        pointsDone: 0,
        committedCount: 0,
        committedPoints: 0,
        completedCount: 0,
        completedPoints: 0,
        rolledCount: 0,
        ...overrides,
    }
}

describe('sprintLabel', () => {
    it('reads the number when the team gave no name', () => {
        expect(sprintLabel({ number: 4, name: '' })).toBe('Sprint 4')
    })

    it('prefers the name', () => {
        expect(sprintLabel({ number: 4, name: 'Launch week' })).toBe('Launch week')
    })

    it('reads an un-numbered sprint as new — the beat before the allocator answers', () => {
        expect(sprintLabel({ number: 0, name: '' })).toBe('New sprint')
    })
})

describe('sprintLengthDays', () => {
    it('reads 0 as the default — PocketBase stores an omitted number as 0', () => {
        expect(sprintLengthDays({ sprint_length_days: 0 })).toBe(DEFAULT_SPRINT_LENGTH_DAYS)
    })

    it('keeps a set length', () => {
        expect(sprintLengthDays({ sprint_length_days: 7 })).toBe(7)
    })
})

describe('normalizeSprintRollover', () => {
    it('reads an unset select as next', () => {
        expect(normalizeSprintRollover('')).toBe('next')
        expect(normalizeSprintRollover('backlog')).toBe('backlog')
    })
})

describe('compareSprints', () => {
    it('orders active, then planned by rank, then completed', () => {
        const sorted = [
            sprint({ id: 'done', state: 'completed', position: 'a0' }),
            sprint({ id: 'later', state: 'planned', position: 'a2' }),
            sprint({ id: 'now', state: 'active', position: 'a9' }),
            sprint({ id: 'next', state: 'planned', position: 'a1' }),
        ].sort(compareSprints)
        expect(sorted.map(s => s.id)).toEqual(['now', 'next', 'later', 'done'])
    })
})

describe('daysRemaining', () => {
    const today = new Date(2026, 8, 4, 15, 30)

    it('counts today as a day, so a sprint ending today has one left', () => {
        expect(daysRemaining({ end: new Date(2026, 8, 4) }, today)).toBe(1)
        expect(daysRemaining({ end: new Date(2026, 8, 10) }, today)).toBe(7)
    })

    it('floors at zero once the end has passed', () => {
        expect(daysRemaining({ end: new Date(2026, 8, 1) }, today)).toBe(0)
    })

    it('is undefined for an undated sprint', () => {
        expect(daysRemaining({}, today)).toBeUndefined()
    })
})

describe('sprintProgress', () => {
    it('reports points when the sprint has any, cards otherwise', () => {
        expect(
            sprintProgress(sprint({ cardTotal: 4, cardDone: 1, pointsTotal: 10, pointsDone: 5 }))
        ).toEqual({
            done: 5,
            total: 10,
            unit: 'pts',
            ratio: 0.5,
        })
        expect(sprintProgress(sprint({ cardTotal: 4, cardDone: 1 }))).toEqual({
            done: 1,
            total: 4,
            unit: 'cards',
            ratio: 0.25,
        })
    })

    it('reads an empty sprint as zero rather than dividing by it', () => {
        expect(sprintProgress(sprint()).ratio).toBe(0)
    })
})

describe('defaultSprintDates', () => {
    const today = new Date(2026, 8, 4)

    it("starts today for the board's length when nothing is planned", () => {
        expect(defaultSprintDates([], 14, today)).toEqual({
            start: new Date(2026, 8, 4),
            end: new Date(2026, 8, 17),
        })
    })

    it('starts the day after the latest planned or active sprint ends', () => {
        const dates = defaultSprintDates(
            [
                sprint({ state: 'active', end: new Date(2026, 8, 10) }),
                sprint({ state: 'planned', end: new Date(2026, 8, 24) }),
                // Completed sprints are history and do not push the date.
                sprint({ state: 'completed', end: new Date(2026, 11, 31) }),
            ],
            7,
            today
        )
        expect(dates).toEqual({ start: new Date(2026, 8, 25), end: new Date(2026, 9, 1) })
    })

    it('falls back to today when the latest sprint already ended', () => {
        const dates = defaultSprintDates(
            [sprint({ state: 'active', end: new Date(2026, 7, 1) })],
            7,
            today
        )
        expect(dates.start).toEqual(new Date(2026, 8, 4))
    })
})

describe('formatSprintDates', () => {
    it('reads a range, a bare start, a bare end, or nothing', () => {
        expect(
            formatSprintDates({ start: new Date(2026, 8, 1), end: new Date(2026, 8, 14) }, 'en-US')
        ).toBe('Sep 1 – Sep 14')
        expect(formatSprintDates({ start: new Date(2026, 8, 1) }, 'en-US')).toBe('from Sep 1')
        expect(formatSprintDates({ end: new Date(2026, 8, 14) }, 'en-US')).toBe('until Sep 14')
        expect(formatSprintDates({}, 'en-US')).toBe('')
    })
})
