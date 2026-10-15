// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

const queryClient = new QueryClient()
const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

type StoreRow = { id: string } & Record<string, unknown>

const h = vi.hoisted(() => {
    const card = (id: string, extra: Record<string, unknown>) => ({
        id,
        project: 'p1',
        list: 'l1',
        position: 'a0',
        title: 'Card one',
        description: '',
        due: '',
        due_has_time: false,
        start: '',
        assignees: [] as string[],
        labels: [] as string[],
        created_by: 'u1',
        reporter: 'u1',
        priority: 'none',
        estimate: 0,
        parent: '',
        archived: false,
        checklist_total: 0,
        checklist_done: 0,
        comment_count: 0,
        attachment_count: 0,
        subtask_total: 0,
        subtask_done: 0,
        epic: '',
        sprint: '',
        form: '',
        fields: {},
        ...extra,
    })
    return {
        cards: [card('c1', {}), card('c2', { form: 'f1', fields: { x: 1 }, title: 'Typed' })],
        stores: {} as Record<
            string,
            { get: (id: string) => StoreRow | undefined; toArray: StoreRow[] }
        >,
    }
})

vi.mock('@tinycld/core/lib/auth', () => ({
    useAuth: () => ({ user: { id: 'u1' }, isLoggedIn: true }),
}))

vi.mock('@tinycld/core/lib/pocketbase', async () => {
    const { createCollection, localOnlyCollectionOptions } = await import('@tanstack/db')
    const mk = (id: string, initialData: { id: string }[]) =>
        createCollection(
            localOnlyCollectionOptions({ id, getKey: (r: { id: string }) => r.id, initialData })
        )
    h.stores.boards_cards = mk('boards_cards', h.cards)
    h.stores.boards_checklist_items = mk('boards_checklist_items', [])
    return {
        useStore: (...names: string[]) => names.map(n => h.stores[n]),
    }
})

import {
    useCreateCard,
    useDuplicateCard,
    useUpdateCard,
} from '~/tinycld/boards/hooks/useCardMutations'
import type { BoardCardView } from '~/tinycld/boards/types'

describe('useCreateCard', () => {
    it('writes the form, the custom fields, the extra columns and the checklist rows', async () => {
        const { result } = renderHook(() => useCreateCard('p1'), { wrapper })
        let id = ''
        await act(async () => {
            id = await result.current.mutateAsync({
                listId: 'l1',
                title: 'Bug',
                position: 'a0',
                formId: 'f-bug',
                fields: { severity: 'high' },
                columns: { priority: 'high', due: '2026-02-01 00:00:00.000Z' },
                checklist: [
                    { text: 'Repro', done: false },
                    { text: 'Fix', done: true },
                ],
            })
        })
        expect(h.stores.boards_cards.get(id)).toMatchObject({
            form: 'f-bug',
            fields: { severity: 'high' },
            priority: 'high',
            due: '2026-02-01 00:00:00.000Z',
        })
        const items = h.stores.boards_checklist_items.toArray.filter(i => i.card === id)
        items.sort((a, b) => String(a.position).localeCompare(String(b.position)))
        expect(items.map(i => [i.title, i.is_done])).toEqual([
            ['Repro', false],
            ['Fix', true],
        ])
        expect(String(items[0].position) < String(items[1].position)).toBe(true)
    })

    it('defaults form to empty and fields to an empty object', async () => {
        const { result } = renderHook(() => useCreateCard('p1'), { wrapper })
        let id = ''
        await act(async () => {
            id = await result.current.mutateAsync({ listId: 'l1', title: 'T', position: 'a0' })
        })
        expect(h.stores.boards_cards.get(id)).toMatchObject({ form: '', fields: {} })
    })
})

describe('useUpdateCard', () => {
    it('patches form, fields and the listed columns and nothing else', async () => {
        const { result } = renderHook(() => useUpdateCard(), { wrapper })
        await act(async () => {
            await result.current.mutateAsync({
                cardId: 'c1',
                form: 'f2',
                fields: { a: 1 },
                start: '2026-01-01 00:00:00.000Z',
            })
        })
        expect(h.stores.boards_cards.get('c1')).toMatchObject({
            form: 'f2',
            fields: { a: 1 },
            start: '2026-01-01 00:00:00.000Z',
            title: 'Card one',
            priority: 'none',
        })
    })
})

describe('useDuplicateCard', () => {
    it('copies the form and the custom fields', async () => {
        const { result } = renderHook(() => useDuplicateCard('p1'), { wrapper })
        const source: BoardCardView = {
            id: 'c2',
            key: '',
            number: 0,
            listId: 'l1',
            position: 'a0',
            title: 'Typed',
            description: '',
            dueHasTime: false,
            labels: [],
            assignees: [],
            priority: 'none',
            parent: '',
        } as unknown as BoardCardView
        let id = ''
        await act(async () => {
            id = await result.current.mutateAsync({ card: source, position: 'a1' })
        })
        expect(h.stores.boards_cards.get(id)).toMatchObject({ form: 'f1', fields: { x: 1 } })
    })
})
