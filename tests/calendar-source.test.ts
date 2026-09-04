import { appHref } from '@tinycld/core/lib/org-routes'
import type { Href } from 'expo-router'
import { describe, expect, it } from 'vitest'
import { buildDueItems } from '../tinycld/cards/calendar-source'

// Delegates the prefix to appHref so this stand-in can't drift from the app's
// actual route shape.
const orgHref = (path: string, extra?: Record<string, string>): Href =>
    ({ pathname: appHref(path), params: extra }) as Href

describe('buildDueItems', () => {
    it('maps a due card to a local all-day item with a card href', () => {
        const items = buildDueItems(
            [
                {
                    id: 'r8f3k2m9x1p7q4w',
                    title: 'Ship the release',
                    due: '2026-08-04 00:00:00.000Z',
                    due_has_time: false,
                },
            ],
            orgHref
        )
        expect(items).toHaveLength(1)
        const item = items[0]
        expect(item.id).toBe('r8f3k2m9x1p7q4w')
        expect(item.title).toBe('Ship the release')
        expect(item.allDay).toBe(true)
        expect(item.href).toEqual({
            pathname: '/a/cards/[cardId]',
            params: { cardId: 'r8f3k2m9x1p7q4w' },
        })
        // The stored value names a DAY; the item must span that day in the
        // runner's LOCAL frame regardless of timezone. This is the off-by-one
        // regression the due picker already shipped once (card-editing e2e):
        // asserting only "a valid date" is how it got through.
        const start = new Date(item.start)
        const end = new Date(item.end)
        expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 7, 4])
        expect([start.getHours(), start.getMinutes()]).toEqual([0, 0])
        expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2026, 7, 4])
        expect([end.getHours(), end.getMinutes(), end.getSeconds()]).toEqual([23, 59, 59])
    })

    it('handles the bare day string an optimistic local row carries', () => {
        // The picker writes 'YYYY-MM-DD'; PocketBase normalizes it later. Both
        // spellings must land on the same local day.
        const [bare] = buildDueItems(
            [{ id: 'a', title: 'T', due: '2026-08-04', due_has_time: false }],
            orgHref
        )
        const [normalized] = buildDueItems(
            [{ id: 'a', title: 'T', due: '2026-08-04 00:00:00.000Z', due_has_time: false }],
            orgHref
        )
        expect(bare.start).toBe(normalized.start)
        expect(bare.end).toBe(normalized.end)
    })

    it('drops rows with empty or unparseable due values', () => {
        const items = buildDueItems(
            [
                { id: 'a', title: 'No due', due: '', due_has_time: false },
                { id: 'b', title: 'Garbage', due: 'not-a-date', due_has_time: false },
                { id: 'c', title: 'Real', due: '2026-08-04', due_has_time: false },
            ],
            orgHref
        )
        expect(items.map(i => i.id)).toEqual(['c'])
    })

    it('lands a timed due date at its instant as a short timed item', () => {
        const instant = new Date(2026, 7, 4, 14, 30)
        const [item] = buildDueItems(
            [{ id: 'a', title: 'T', due: instant.toISOString(), due_has_time: true }],
            orgHref
        )
        expect(item.allDay).toBe(false)
        expect(new Date(item.start).getTime()).toBe(instant.getTime())
        expect(new Date(item.end).getTime() - instant.getTime()).toBe(30 * 60 * 1000)
    })

    it('keeps a timed due date near midnight on its local day', () => {
        const lateInstant = new Date(2026, 7, 4, 23, 30)
        const [item] = buildDueItems(
            [{ id: 'a', title: 'T', due: lateInstant.toISOString(), due_has_time: true }],
            orgHref
        )
        const start = new Date(item.start)
        expect([start.getDate(), start.getHours(), start.getMinutes()]).toEqual([4, 23, 30])
    })

    it('preserves row order', () => {
        const items = buildDueItems(
            [
                { id: 'later', title: 'B', due: '2026-08-06', due_has_time: false },
                { id: 'earlier', title: 'A', due: '2026-08-02', due_has_time: false },
            ],
            orgHref
        )
        expect(items.map(i => i.id)).toEqual(['later', 'earlier'])
    })
})
