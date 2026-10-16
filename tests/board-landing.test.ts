import { describe, expect, it } from 'vitest'
import { boardLanding } from '../tinycld/boards/lib/board-landing'

const fresh = (segment: string, card?: string) => ({
    key: 'new',
    name: '[boardSlug]',
    params: card
        ? { boardSlug: segment, screen: '[card]', params: { boardSlug: segment, card } }
        : { boardSlug: segment, screen: 'index', params: { boardSlug: segment } },
})

describe('landing on a board', () => {
    it('replaces the board on screen with a fresh one, so its cards do not carry over', () => {
        const routes = [{ key: 'pl', name: '[boardSlug]' }]
        expect(boardLanding(routes, 0, { segment: 'OTTER', card: 'OTTER-3', key: 'new' })).toEqual({
            routes: [fresh('OTTER', 'OTTER-3')],
            index: 0,
        })
    })

    it('drops the board under the bare /a/boards, so one board layout remains', () => {
        const routes = [
            { key: 'pl', name: '[boardSlug]' },
            { key: 'idx', name: 'index' },
        ]
        expect(boardLanding(routes, 1, { segment: 'OTTER', card: 'OTTER-3', key: 'new' })).toEqual({
            routes: [fresh('OTTER', 'OTTER-3')],
            index: 0,
        })
    })

    it('keeps My cards beneath, and lands on the bare board for no card', () => {
        const routes = [
            { key: 'mine', name: 'my-cards' },
            { key: 'idx', name: 'index' },
        ]
        expect(boardLanding(routes, 1, { segment: 'PL', card: '', key: 'new' })).toEqual({
            routes: [{ key: 'mine', name: 'my-cards' }, fresh('PL')],
            index: 1,
        })
    })

    it('ignores routes above the one on screen', () => {
        const routes = [
            { key: 'idx', name: 'index' },
            { key: 'mine', name: 'my-cards' },
        ]
        expect(boardLanding(routes, 0, { segment: 'PL', card: '', key: 'new' }).routes).toEqual([
            fresh('PL'),
        ])
    })
})
