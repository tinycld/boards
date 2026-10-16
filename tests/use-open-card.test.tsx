// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BoardLayoutProvider } from '../tinycld/boards/hooks/useBoardLayout'
import { useOpenCard } from '../tinycld/boards/hooks/useOpenCard'
import type { BoardProject } from '../tinycld/boards/types'

afterEach(cleanup)

// The `[card]` child's own param is what names the card: a covered child keeps
// resolving its OWN card, never the one on top of it.
const h = vi.hoisted(() => ({ params: {} as Record<string, string> }))

vi.mock('expo-router', () => ({
    useLocalSearchParams: () => h.params,
}))

function card(id: string, key: string, number: number) {
    return {
        id,
        key,
        number,
        listId: 'l1',
        position: 'a0',
        title: id,
        description: '',
        labels: [],
        assignees: [],
        checklistTotal: 0,
        checklistDone: 0,
        commentCount: 0,
        attachmentCount: 0,
        listCategory: 'todo',
    }
}

// abcdefghijklmno is a card the server has not numbered yet: no key, number 0.
const project = {
    id: 'p1',
    name: 'Planning',
    slug: 'PL',
    color: '#4A86E8',
    members: [],
    labels: [],
    listOrder: [{ id: 'l1', position: 'a0' }],
    lists: [
        {
            id: 'l1',
            name: 'To do',
            position: 'a0',
            category: 'todo',
            cards: [card('c1', 'PL-1', 1), card('c2', 'PL-2', 2), card('abcdefghijklmno', '', 0)],
        },
    ],
} as BoardProject

// The board as the reader's filter leaves it: card 2 hidden.
const filtered = {
    ...project,
    lists: project.lists.map(list => ({
        ...list,
        cards: list.cards.filter(card => card.id !== 'c2'),
    })),
} as BoardProject

function wrapper({ children }: { children: ReactNode }) {
    return (
        <BoardLayoutProvider
            value={{
                project: filtered,
                fullProject: project,
                segment: 'PL',
                isArchived: false,
                cardCount: 2,
            }}
        >
            {children}
        </BoardLayoutProvider>
    )
}

function openCardFor(segment: string | undefined) {
    h.params = segment === undefined ? {} : { card: segment }
    return renderHook(() => useOpenCard(), { wrapper }).result.current
}

describe('useOpenCard', () => {
    // A card is resolved on the whole board, not the reader's view of it: a
    // link to a card the filter hides still opens it, and a filter changed
    // with the card open does not take it away.
    it('a card the reader has filtered out still resolves', () => {
        expect(openCardFor('PL-2')).toEqual({ cardId: 'c2', surface: 'peek' })
        expect(openCardFor('2')).toEqual({ cardId: 'c2', surface: 'page' })
    })

    it('a key on this board opens the peek', () => {
        expect(openCardFor('PL-2')).toEqual({ cardId: 'c2', surface: 'peek' })
        // Typed from memory as often as pasted.
        expect(openCardFor('pl-2')).toEqual({ cardId: 'c2', surface: 'peek' })
    })

    it('a key of another board is nothing', () => {
        expect(openCardFor('OTTER-2')).toBeNull()
    })

    it('a key with no such card is nothing', () => {
        expect(openCardFor('PL-9')).toBeNull()
    })

    it('a number opens the page', () => {
        expect(openCardFor('2')).toEqual({ cardId: 'c2', surface: 'page' })
    })

    it('an unnumbered id opens the peek', () => {
        expect(openCardFor('abcdefghijklmno')).toEqual({
            cardId: 'abcdefghijklmno',
            surface: 'peek',
        })
    })

    it('the index child has no card', () => {
        expect(openCardFor(undefined)).toBeNull()
    })

    it('junk is nothing', () => {
        expect(openCardFor('my-cards')).toBeNull()
    })
})
