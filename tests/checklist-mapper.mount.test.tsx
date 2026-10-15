// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

// The engine reads and writes the card's checklist through this mapper, so it
// is mounted against real TanStack DB collections: local-only ones, which
// prove the query and the writes, not the on-demand loading pbtsdb adds.
const h = vi.hoisted(() => ({
    stores: {} as Record<string, unknown>,
}))

vi.mock('@tinycld/core/lib/pocketbase', async () => {
    const { createCollection, localOnlyCollectionOptions } = await import('@tanstack/db')
    const mk = (id: string, initialData: { id: string }[]) =>
        createCollection(
            localOnlyCollectionOptions({ id, getKey: (r: { id: string }) => r.id, initialData })
        )
    h.stores = {
        boards_cards: mk('boards_cards', [{ id: 'c1', project: 'p1', title: 'One' }]),
        boards_checklist_items: mk('boards_checklist_items', [
            { id: 'i2', card: 'c1', project: 'p1', title: 'Second', is_done: true, position: 'a1' },
            { id: 'i1', card: 'c1', project: 'p1', title: 'First', is_done: false, position: 'a0' },
            { id: 'i9', card: 'c2', project: 'p1', title: 'Other', is_done: false, position: 'a0' },
        ]),
    }
    return { useStore: (...names: string[]) => names.map(name => h.stores[name]) }
})

import { checklistMapper } from '../tinycld/boards/forms/checklist-mapper'

interface ItemRow {
    id: string
    card: string
    project: string
    title: string
    is_done: boolean
    position: string
}

function item(id: string): ItemRow | undefined {
    return (h.stores.boards_checklist_items as { get: (id: string) => ItemRow | undefined }).get(id)
}

describe('checklist mapper', () => {
    it('reads rows as checklist items in position order', async () => {
        const { result } = renderHook(() => checklistMapper.useRows('c1'))
        await waitFor(() => expect(result.current.isReady).toBe(true))
        expect(result.current.items).toEqual([
            { id: 'i1', text: 'First', done: false },
            { id: 'i2', text: 'Second', done: true },
        ])
    })

    it('inserts after the last row, updates text and done, removes, and reorders', async () => {
        // Mounted beside the rows, as the engine does, so the test can wait for
        // the live state the insert reads (the last row's rank) to settle.
        const { result: hook } = renderHook(() => ({
            rows: checklistMapper.useRows('c1'),
            mutations: checklistMapper.useMutations('c1'),
        }))
        await waitFor(() => expect(hook.current.rows.items).toHaveLength(2))
        const result = {
            get current() {
                return hook.current.mutations
            },
        }

        await act(() => result.current.insert({ id: 'i3', text: 'Third', done: false }))
        expect(item('i3')).toMatchObject({
            card: 'c1',
            project: 'p1',
            title: 'Third',
            is_done: false,
        })
        expect((item('i3')?.position ?? '') > 'a1').toBe(true)

        await act(() => result.current.update({ id: 'i3', text: 'Third!', done: true }))
        expect(item('i3')).toMatchObject({ title: 'Third!', is_done: true })

        await act(() => result.current.reorder(['i3', 'i1', 'i2']))
        const order = ['i1', 'i2', 'i3'].sort((a, b) =>
            (item(a)?.position ?? '').localeCompare(item(b)?.position ?? '')
        )
        expect(order).toEqual(['i3', 'i1', 'i2'])

        await act(() => result.current.remove('i3'))
        expect(item('i3')).toBeUndefined()
    })
})
