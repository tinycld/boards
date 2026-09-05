import { describe, expect, it } from 'vitest'
import {
    DEFAULT_SPRINT_LENGTH_DAYS,
    normalizeSprintRollover,
    sprintLabel,
    sprintLengthDays,
} from '../tinycld/boards/lib/sprint'

describe('sprintLabel', () => {
    it('reads the number when the team gave no name', () => {
        expect(sprintLabel({ number: 4, name: '' })).toBe('Sprint 4')
    })

    it('prefers the name', () => {
        expect(sprintLabel({ number: 4, name: 'Launch week' })).toBe('Launch week')
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
