import { appHref } from '@tinycld/core/lib/org-routes'
import type { Href } from 'expo-router'
import { describe, expect, it } from 'vitest'
import { buildSprintItems } from '../tinycld/boards/calendar-sprint-source'

const orgHref = (path: string, extra?: Record<string, string>): Href =>
    ({ pathname: appHref(path), params: extra }) as Href

describe('buildSprintItems', () => {
    it('marks a dated sprint on its first and last local day', () => {
        const items = buildSprintItems(
            [
                {
                    id: 's1',
                    number: 3,
                    name: '',
                    start: '2026-09-01 00:00:00.000Z',
                    end: '2026-09-14 00:00:00.000Z',
                    boardName: 'Product launch',
                },
            ],
            orgHref
        )
        expect(items.map(item => item.title)).toEqual([
            'Sprint 3 · Product launch starts',
            'Sprint 3 · Product launch ends',
        ])
        expect(items.every(item => item.allDay)).toBe(true)
        const start = new Date(items[0].start)
        const end = new Date(items[1].start)
        expect([start.getMonth(), start.getDate()]).toEqual([8, 1])
        expect([end.getMonth(), end.getDate()]).toEqual([8, 14])
        expect(items[0].href).toEqual({ pathname: '/a/boards', params: undefined })
    })

    it('skips the halves an undated sprint lacks rather than guessing', () => {
        const items = buildSprintItems(
            [
                {
                    id: 's2',
                    number: 4,
                    name: 'Polish',
                    start: '',
                    end: '2026-09-28 00:00:00.000Z',
                    boardName: 'B',
                },
            ],
            orgHref
        )
        expect(items.map(item => item.title)).toEqual(['Polish · B ends'])
    })
})
