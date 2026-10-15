import { describe, expect, it } from 'vitest'
import { cardColumnsFrom } from '../tinycld/boards/lib/card-columns'

describe('cardColumnsFrom', () => {
    it('keeps the filled columns as typed overrides and leaves out the title', () => {
        expect(
            cardColumnsFrom({
                title: 'Login fails',
                due: '2030-01-15',
                labels: ['lb1', 'lb2'],
                priority: 'high',
                estimate: 3,
            })
        ).toEqual({ due: '2030-01-15', labels: ['lb1', 'lb2'], priority: 'high', estimate: 3 })
    })

    it('drops a column an input left empty, so the insert keeps its default', () => {
        expect(cardColumnsFrom({ due: null, reporter: null, assignees: undefined })).toEqual({})
    })

    it('refuses a value of the wrong shape rather than writing it', () => {
        expect(() => cardColumnsFrom({ priority: 'critical' })).toThrow()
        expect(() => cardColumnsFrom({ labels: 'lb1' })).toThrow()
    })
})
