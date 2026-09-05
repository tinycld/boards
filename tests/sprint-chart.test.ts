import { fromDateString } from '@tinycld/core/lib/dates'
import { describe, expect, it } from 'vitest'
import {
    buildSprintChart,
    buildVelocity,
    type SprintSnapshot,
    sprintUnit,
    toSprintSnapshot,
} from '~/tinycld/boards/lib/sprint-chart'
import type { BoardSprint } from '~/tinycld/boards/types'

function sprint(overrides: Partial<BoardSprint> = {}): BoardSprint {
    return {
        id: 's1',
        number: 1,
        name: '',
        goal: '',
        start: fromDateString('2026-09-01') ?? undefined,
        end: fromDateString('2026-09-05') ?? undefined,
        state: 'active',
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

function snap(
    day: string,
    scope: number,
    done: number,
    points = 0,
    donePoints = 0
): SprintSnapshot {
    return { day, scopeCount: scope, doneCount: done, scopePoints: points, donePoints }
}

describe('toSprintSnapshot', () => {
    it('keeps the day the server named, whatever zone reads it', () => {
        const row = toSprintSnapshot({
            id: 'x',
            sprint: 's1',
            project: 'p',
            day: '2026-09-03 00:00:00.000Z',
            scope_count: 4,
            scope_points: 9,
            done_count: 1,
            done_points: 3,
            created: '',
        })
        expect(row).toEqual({
            day: '2026-09-03',
            scopeCount: 4,
            scopePoints: 9,
            doneCount: 1,
            donePoints: 3,
        })
    })
})

describe('sprintUnit', () => {
    it('is points once anything was estimated, cards otherwise', () => {
        expect(sprintUnit(sprint(), [])).toBe('cards')
        expect(sprintUnit(sprint({ committedPoints: 5 }), [])).toBe('pts')
        expect(sprintUnit(sprint(), [snap('2026-09-01', 3, 0, 8)])).toBe('pts')
    })
})

describe('buildSprintChart', () => {
    it('is nothing for an undated sprint', () => {
        expect(buildSprintChart(sprint({ start: undefined }), [])).toBeNull()
    })

    it('draws one point per day, breaking the line where no snapshot exists', () => {
        const chart = buildSprintChart(sprint({ committedCount: 4 }), [
            snap('2026-09-01', 4, 0),
            snap('2026-09-02', 4, 1),
            snap('2026-09-04', 5, 3),
        ])
        expect(chart?.unit).toBe('cards')
        expect(chart?.points.map(p => p.day)).toEqual([
            '2026-09-01',
            '2026-09-02',
            '2026-09-03',
            '2026-09-04',
            '2026-09-05',
        ])
        expect(chart?.points.map(p => p.remaining)).toEqual([4, 3, null, 2, null])
        // Scope grew mid-sprint: the ceiling follows it.
        expect(chart?.max).toBe(5)
    })

    it('runs the ideal line from the commitment to zero on the last day', () => {
        const chart = buildSprintChart(sprint({ committedPoints: 8 }), [])
        expect(chart?.points.map(p => p.ideal)).toEqual([8, 6, 4, 2, 0])
    })

    it('starts the ideal line from the first snapshot when nothing was committed', () => {
        const chart = buildSprintChart(sprint(), [snap('2026-09-01', 6, 0)])
        expect(chart?.points[0]?.ideal).toBe(6)
    })

    it('ignores snapshots outside the sprint and a one-day sprint has no slope', () => {
        const one = buildSprintChart(
            sprint({ end: fromDateString('2026-09-01') ?? undefined, committedCount: 3 }),
            [snap('2026-08-31', 9, 9), snap('2026-09-01', 3, 1)]
        )
        expect(one?.points).toHaveLength(1)
        expect(one?.points[0]).toMatchObject({ remaining: 2, ideal: 0 })
        expect(one?.max).toBe(3)
    })
})

describe('buildVelocity', () => {
    const done = (number: number, committed: number, completed: number, points = false) =>
        sprint({
            id: `s${number}`,
            number,
            state: 'completed',
            committedCount: points ? 0 : committed,
            completedCount: points ? 0 : completed,
            committedPoints: points ? committed : 0,
            completedPoints: points ? completed : 0,
        })

    it('takes the last six completed sprints, oldest first, and averages what they finished', () => {
        const sprints = [8, 3, 1, 5, 2, 7, 4, 6].map(n => done(n, 10, n))
        sprints.push(sprint({ id: 'active', number: 9, state: 'active', committedCount: 10 }))
        const velocity = buildVelocity(sprints)
        expect(velocity.bars.map(b => b.sprint.number)).toEqual([3, 4, 5, 6, 7, 8])
        expect(velocity.average).toBe((3 + 4 + 5 + 6 + 7 + 8) / 6)
        expect(velocity.unit).toBe('cards')
    })

    it('reads in points when any sprint had them, and is empty with none completed', () => {
        expect(buildVelocity([done(1, 5, 4), done(2, 13, 8, true)]).unit).toBe('pts')
        expect(buildVelocity([])).toEqual({ unit: 'cards', bars: [], average: 0 })
    })
})
