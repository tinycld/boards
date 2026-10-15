// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, renderHook, waitFor } from '@testing-library/react'
import { useWindowSizeStore } from '@tinycld/core/lib/stores/window-size-store'
import { Menu } from '@tinycld/core/ui/menu'
import { OverlayProvider } from '@tinycld/core/ui/overlay'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

// "Change type" over local-only stores: the default "Card" type, a live "Bug"
// type and an archived "Legacy" type. c1 is still on Legacy, c2 has no type
// yet (the server fills the default), c3 and c4 are Bugs; only c4 is changed.

type StoreRow = { id: string } & Record<string, unknown>

const h = vi.hoisted(() => ({
    stores: {} as Record<string, { get: (id: string) => StoreRow | undefined }>,
}))

vi.mock('@tinycld/core/lib/auth', () => ({
    useAuth: () => ({ user: { id: 'u1' }, isLoggedIn: true }),
}))

vi.mock('@tinycld/core/lib/pocketbase', async () => {
    const { BasicIndex, createCollection, localOnlyCollectionOptions } = await import(
        '@tanstack/db'
    )
    const definition = {
        version: 1,
        pages: [{ key: 'main', title: 'Card' }],
        fields: [],
        rules: [],
        defaults: {},
        submit: { required: [] },
    }
    const form = (id: string, name: string, order: number, archived: boolean) => ({
        id,
        host: 'boards:card',
        name,
        slug: name.toLowerCase(),
        is_default: order === 0,
        archived,
        order,
        definition,
    })
    const mk = (id: string, initialData: { id: string }[]) => {
        const collection = createCollection({
            ...localOnlyCollectionOptions({ id, getKey: (r: { id: string }) => r.id, initialData }),
            autoIndex: 'eager',
            defaultIndexType: BasicIndex,
        })
        return Object.assign(collection, { fetchRelations: () => collection })
    }
    const card = (id: string, formId: string) => ({ id, project: 'p1', title: id, form: formId })
    Object.assign(h.stores, {
        forms: mk('forms', [
            form('f-card', 'Card', 0, false),
            form('f-bug', 'Bug', 1, false),
            form('f-legacy', 'Legacy', 2, true),
        ]),
        boards_cards: mk('boards_cards', [
            card('c1', 'f-legacy'),
            card('c2', ''),
            card('c3', 'f-bug'),
            card('c4', 'f-bug'),
        ]),
    })
    return { useStore: (...names: string[]) => names.map(n => h.stores[n]) }
})

import { ChangeTypeRows, useCardTypes } from '../tinycld/boards/components/detail/CardActionsMenu'

function wrapper({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={new QueryClient()}>
            <OverlayProvider>{children}</OverlayProvider>
        </QueryClientProvider>
    )
}

/** The rows inside an open menu, as the card's actions menu renders them. */
function OpenMenu({ cardId }: { cardId: string }) {
    const types = useCardTypes(cardId)
    return (
        <Menu isOpen onOpenChange={() => {}} anchor={{ x: 10, y: 10 }} testID="menu">
            <ChangeTypeRows types={types} />
        </Menu>
    )
}

// Menu rows are DOM elements on web (data-testid); the rest are RN stubs (testID).
const byId = (root: ParentNode, id: string) =>
    root.querySelector<HTMLElement>(`[testID="${id}"], [data-testid="${id}"]`)
const isChecked = (row: HTMLElement | null) => row?.querySelector('[data-check]') != null

describe('useCardTypes', () => {
    it('offers only the live types, and marks an archived current one', async () => {
        const { result } = renderHook(() => useCardTypes('c1'), { wrapper })
        // Waits for the card row too: before it loads, the default reads as current.
        await waitFor(() =>
            expect(result.current.choices).toEqual([
                { id: 'f-card', name: 'Card', isCurrent: false },
                { id: 'f-bug', name: 'Bug', isCurrent: false },
            ])
        )
        // The card keeps its archived type, so every live one is a change.
        expect(result.current.isOffered).toBe(true)
    })

    it('marks the default as current while the card has no type', async () => {
        const { result } = renderHook(() => useCardTypes('c2'), { wrapper })
        await waitFor(() => expect(result.current.choices).toHaveLength(2))
        expect(result.current.choices.find(c => c.isCurrent)?.id).toBe('f-card')
        expect(result.current.isOffered).toBe(true)
    })

    it('writes the picked type on the card row', async () => {
        const { result } = renderHook(() => useCardTypes('c4'), { wrapper })
        await waitFor(() => expect(result.current.choices.find(c => c.isCurrent)?.id).toBe('f-bug'))
        await act(async () => result.current.change('f-card'))
        await waitFor(() => expect(h.stores.boards_cards.get('c4')?.form).toBe('f-card'))
    })
})

describe('ChangeTypeRows', () => {
    it('hides when the only live type is the one the card has', () => {
        const { container } = render(
            <Menu isOpen onOpenChange={() => {}} anchor={{ x: 10, y: 10 }} presentation="popover">
                <ChangeTypeRows
                    types={{
                        choices: [{ id: 'f-card', name: 'Card', isCurrent: true }],
                        isOffered: false,
                        change: () => {},
                    }}
                />
            </Menu>,
            { wrapper }
        )
        expect(byId(container, 'card-change-type')).toBeNull()
    })

    it('opens a submenu with one row per live type, the current one checked', async () => {
        const { container, getByText } = render(
            <Menu isOpen onOpenChange={() => {}} anchor={{ x: 10, y: 10 }} presentation="popover">
                <RowsFor cardId="c2" />
            </Menu>,
            { wrapper }
        )
        await waitFor(() => expect(byId(container, 'card-change-type')).toBeTruthy())
        fireEvent.click(getByText('Change type'))
        expect(isChecked(byId(container, 'card-change-type-f-card'))).toBe(true)
        expect(isChecked(byId(container, 'card-change-type-f-bug'))).toBe(false)
        expect(byId(container, 'card-change-type-f-legacy')).toBeNull()
    })

    it('lists the types inline under a heading in a phone sheet', async () => {
        useWindowSizeStore.getState().setSize(390, 844)
        try {
            const { container } = render(<OpenMenu cardId="c3" />, { wrapper })
            await waitFor(() => expect(byId(container, 'card-change-type')).toBeTruthy())
            expect(byId(container, 'card-change-type')?.textContent).toBe('Change type')
            // No submenu to open: the rows are already there, once the card's
            // own type has loaded.
            await waitFor(() =>
                expect(isChecked(byId(container, 'card-change-type-f-bug'))).toBe(true)
            )
            expect(byId(container, 'card-change-type-f-card')).toBeTruthy()
        } finally {
            useWindowSizeStore.getState().setSize(1024, 768)
        }
    })
})

function RowsFor({ cardId }: { cardId: string }) {
    return <ChangeTypeRows types={useCardTypes(cardId)} />
}
