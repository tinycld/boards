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
            [{ id: 'r8f3k2m9x1p7q4w', title: 'Ship the release', due: '2026-08-04 00:00:00.000Z' }],
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
        const [bare] = buildDueItems([{ id: 'a', title: 'T', due: '2026-08-04' }], orgHref)
        const [normalized] = buildDueItems(
            [{ id: 'a', title: 'T', due: '2026-08-04 00:00:00.000Z' }],
            orgHref
        )
        expect(bare.start).toBe(normalized.start)
        expect(bare.end).toBe(normalized.end)
    })

    it('drops rows with empty or unparseable due values', () => {
        const items = buildDueItems(
            [
                { id: 'a', title: 'No due', due: '' },
                { id: 'b', title: 'Garbage', due: 'not-a-date' },
                { id: 'c', title: 'Real', due: '2026-08-04' },
            ],
            orgHref
        )
        expect(items.map(i => i.id)).toEqual(['c'])
    })

    it('preserves row order', () => {
        const items = buildDueItems(
            [
                { id: 'later', title: 'B', due: '2026-08-06' },
                { id: 'earlier', title: 'A', due: '2026-08-02' },
            ],
            orgHref
        )
        expect(items.map(i => i.id)).toEqual(['later', 'earlier'])
    })
})
