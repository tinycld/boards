// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { OverlayProvider } from '@tinycld/core/ui/overlay'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

// The full-form dialog over local-only collections: the forms store offers a
// default "Card" type and a "Bug" type that adds a required Severity select,
// and the card and its checklist rows land in their own stores.

type StoreRow = { id: string } & Record<string, unknown>

const h = vi.hoisted(() => ({
    stores: {} as Record<string, { toArray: StoreRow[] }>,
}))

vi.mock('@tinycld/core/lib/auth', () => ({
    useAuth: () => ({ user: { id: 'u1' }, isLoggedIn: true }),
}))

vi.mock('@tinycld/core/components/workspace/useBreakpoint', () => ({
    useBreakpoint: () => 'desktop',
}))

// The host's UI module loads every section, and the reactions section's emoji
// picker loads FlashList, whose CommonJS build reaches the real react-native.
// No section renders before the card exists, so a list that draws nothing is enough.
vi.mock('@shopify/flash-list', () => ({ FlashList: () => null }))

vi.mock('@tinycld/core/lib/forms/use-form-hosts', async () => {
    const { hostDefListSchema } = await import('@tinycld/core/lib/forms/host')
    const { default: hosts } = await import('../tinycld/boards/forms/hosts')
    const [def] = hostDefListSchema.parse(hosts)
    const host = {
        ...def,
        pkgSlug: 'boards',
        ui: async () => (await import('../tinycld/boards/forms/ui')).default,
    }
    return { useFormHost: (key: string | undefined) => (key === host.key ? host : undefined) }
})

vi.mock('@tinycld/core/lib/pocketbase', async () => {
    const { BasicIndex, createCollection, localOnlyCollectionOptions } = await import(
        '@tanstack/db'
    )
    const { hostDefListSchema, defaultDefinitionFor } = await import('@tinycld/core/lib/forms/host')
    const { default: hosts } = await import('../tinycld/boards/forms/hosts')
    const [host] = hostDefListSchema.parse(hosts)
    const base = defaultDefinitionFor(host)
    const severity = {
        key: 'severity',
        kind: 'select',
        page: 'main',
        label: 'Severity',
        width: 'full',
        required: true,
        hidden: false,
        options: [
            { value: 'low', label: 'Low' },
            { value: 'high', label: 'High' },
        ],
    }
    const form = (id: string, name: string, order: number, definition: unknown) => ({
        id,
        host: host.key,
        name,
        slug: name.toLowerCase(),
        is_default: order === 0,
        archived: false,
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
    Object.assign(h.stores, {
        forms: mk('forms', [
            form('f-card', 'Card', 0, base),
            form('f-bug', 'Bug', 1, { ...base, fields: [...base.fields, severity] }),
        ]),
        boards_projects: mk('boards_projects', [
            { id: 'p1', name: 'Otters', slug: 'OTTER', sprints_enabled: false },
        ]),
        boards_labels: mk('boards_labels', []),
        boards_epics: mk('boards_epics', []),
        boards_sprints: mk('boards_sprints', []),
        boards_cards: mk('boards_cards', []),
        boards_checklist_items: mk('boards_checklist_items', []),
        users: mk('users', []),
    })
    return {
        useStore: (...names: string[]) => names.map(n => h.stores[n]),
        // Core's user picker resolves its collection by name.
        collectionByName: (name: string) => h.stores[name],
    }
})

import { CardCreateDialog } from '../tinycld/boards/components/CardCreateDialog'
import { useCardCreateStore } from '../tinycld/boards/stores/card-create-store'

const q = (container: ParentNode, id: string) =>
    container.querySelector(`[testID="${id}"]`) as HTMLElement | null

function wrapper({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={new QueryClient()}>
            <OverlayProvider>{children}</OverlayProvider>
        </QueryClientProvider>
    )
}

/** Core's select input is a list of option buttons: press the one with this label. */
async function pickSelect(container: HTMLElement, key: string, label: string) {
    const input = await waitFor(() => {
        const found = q(container, `form-input-${key}`)
        if (!found) throw new Error(`no input for ${key}`)
        return found
    })
    const option = [...input.querySelectorAll('rn-pressable')].find(el => el.textContent === label)
    if (!option) throw new Error(`no option "${label}" in ${key}`)
    fireEvent.click(option)
}

function addChecklistItem(container: HTMLElement, text: string) {
    const input = q(container, 'form-input-checklist-new') as HTMLElement
    fireEvent.input(input, { target: { value: text } })
    fireEvent(input, new Event('SubmitEditing'))
}

describe('CardCreateDialog', () => {
    it('renders nothing while no column is targeted', () => {
        useCardCreateStore.getState().close()
        const { container } = render(<CardCreateDialog projectId="p1" />, { wrapper })
        expect(q(container, 'card-create-dialog')).toBeNull()
    })

    it('creates a card of the picked type with its custom values and checklist rows', async () => {
        useCardCreateStore
            .getState()
            .open({ listId: 'l1', position: 'a0', initialTitle: 'Login fails' })
        const { container, getByText, queryAllByText } = render(
            <CardCreateDialog projectId="p1" />,
            { wrapper }
        )
        await waitFor(() => expect(q(container, 'form-field-title')).toBeTruthy())
        expect((q(container, 'form-input-title') as HTMLInputElement).value).toBe('Login fails')

        fireEvent.click(getByText('Bug'))
        await waitFor(() => expect(q(container, 'form-field-severity')).toBeTruthy())
        expect((q(container, 'form-input-title') as HTMLInputElement).value).toBe('Login fails')

        // Create with Severity empty: the form refuses and says why.
        fireEvent.click(q(container, 'form-wizard-next') as HTMLElement)
        await waitFor(() =>
            expect(queryAllByText('Severity is required').length).toBeGreaterThan(0)
        )
        expect(useCardCreateStore.getState().target).not.toBeNull()

        await pickSelect(container, 'severity', 'High')
        addChecklistItem(container, 'Reproduce on staging')
        fireEvent.click(q(container, 'form-wizard-next') as HTMLElement)
        await waitFor(() => expect(useCardCreateStore.getState().target).toBeNull())

        const card = h.stores.boards_cards.toArray.find(c => c.title === 'Login fails')
        expect(card).toMatchObject({
            project: 'p1',
            list: 'l1',
            position: 'a0',
            form: 'f-bug',
            fields: { severity: 'high' },
        })
        const items = h.stores.boards_checklist_items.toArray
        expect(items).toEqual([
            expect.objectContaining({
                card: card?.id,
                project: 'p1',
                title: 'Reproduce on staging',
                is_done: false,
            }),
        ])
    })
})
