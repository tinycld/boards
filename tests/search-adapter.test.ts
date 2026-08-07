import { toRow } from '@tinycld/cards/search-adapter'
import { describe, expect, it } from 'vitest'

describe('cards toRow', () => {
    it('maps a hit to a row with the card title', () => {
        const row = toRow({ id: 'c1', title: 'Ship the budget', project: 'p1', list: 'l1' })
        expect(row).toEqual({
            id: 'c1',
            title: 'Ship the budget',
            subtitle: undefined,
            meta: undefined,
        })
    })

    it('keeps a hit whose title is empty', () => {
        expect(toRow({ id: 'c1', title: '', project: 'p1', list: 'l1' })?.title).toBe(
            'Untitled card'
        )
    })
})
