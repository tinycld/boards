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
    const user = (id: string, name: string) => ({
        id,
        name,
        email: `${id}@test.local`,
        avatar: '',
        avatar_crop: '',
        avatar_color: '',
        avatar_emoji: '',
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
        // Two board members, and an org user who is not on the board.
        users: mk('users', [
            user('u1', 'Maya Kim'),
            user('u2', 'Jonas Reyes'),
            user('u3', 'Org Outsider'),
        ]),
        boards_project_members: mk('boards_project_members', [
            { id: 'm1', project: 'p1', user: 'u1' },
            { id: 'm2', project: 'p1', user: 'u2' },
        ]),
    })
    return {
        useStore: (...names: string[]) => names.map(n => h.stores[n]),
        // Core's user picker resolves its collection by name.
        collectionByName: (name: string) => h.stores[name],
        // A picked member's avatar asks for a file URL; signed out, it asks nothing.
        pb: {
            authStore: { isValid: false },
            files: { getURL: () => '', getToken: async () => '' },
        },
    }
})

import { CardComposer } from '../tinycld/boards/components/CardComposer'
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

const byLabel = (container: ParentNode, label: string) =>
    container.querySelector(`[accessibilityLabel="${label}"]`) as HTMLElement | null

/** A column's composer wired to the dialog the way BoardColumn wires it. */
function ComposerWithDialog() {
    const openCreate = useCardCreateStore(s => s.open)
    return (
        <>
            <CardComposer
                onSubmit={() => {}}
                onExpand={(title, clearDraft) =>
                    openCreate({
                        projectId: 'p1',
                        listId: 'l1',
                        position: 'a1',
                        initialTitle: title,
                        onCreated: clearDraft,
                    })
                }
            />
            <CardCreateDialog projectId="p1" />
        </>
    )
}

describe('CardCreateDialog', () => {
    it('renders nothing while no column is targeted', () => {
        useCardCreateStore.getState().close()
        const { container } = render(<CardCreateDialog projectId="p1" />, { wrapper })
        expect(q(container, 'card-create-dialog')).toBeNull()
    })

    it('stays closed on a board other than the one the target names', () => {
        useCardCreateStore
            .getState()
            .open({ projectId: 'pA', listId: 'lA', position: 'a0', initialTitle: '' })
        const { container } = render(<CardCreateDialog projectId="p1" />, { wrapper })
        expect(q(container, 'card-create-dialog')).toBeNull()
    })

    it('clears the target when it leaves the screen', () => {
        useCardCreateStore
            .getState()
            .open({ projectId: 'p1', listId: 'l1', position: 'a0', initialTitle: '' })
        const { unmount } = render(<CardCreateDialog projectId="p1" />, { wrapper })
        unmount()
        expect(useCardCreateStore.getState().target).toBeNull()
    })

    it('hands the composer draft back when the dialog is cancelled, and drops it once created', async () => {
        useCardCreateStore.getState().close()
        const { container } = render(<ComposerWithDialog />, { wrapper })
        fireEvent.click(byLabel(container, 'Add card') as HTMLElement)
        const input = container.querySelector('rn-textinput') as HTMLInputElement
        fireEvent.input(input, { target: { value: 'Signup fails' } })
        fireEvent.click(q(container, 'card-composer-expand') as HTMLElement)
        await waitFor(() => expect(q(container, 'form-input-title')).toBeTruthy())
        expect((q(container, 'form-input-title') as HTMLInputElement).value).toBe('Signup fails')

        fireEvent.click(byLabel(container, 'Close') as HTMLElement)
        await waitFor(() => expect(q(container, 'card-create-dialog')).toBeNull())
        const composerInput = container.querySelector('rn-textinput') as HTMLInputElement
        expect(composerInput.value).toBe('Signup fails')

        fireEvent.click(q(container, 'card-composer-expand') as HTMLElement)
        await waitFor(() => expect(q(container, 'form-wizard-next')).toBeTruthy())
        fireEvent.click(q(container, 'form-wizard-next') as HTMLElement)
        await waitFor(() => expect(useCardCreateStore.getState().target).toBeNull())
        expect(
            h.stores.boards_cards.toArray.some(
                c => c.title === 'Signup fails' && c.position === 'a1'
            )
        ).toBe(true)
        expect(container.querySelector('rn-textinput')).toBeNull()
        expect(byLabel(container, 'Add card')).toBeTruthy()
    })

    it("offers the board's members, not the org, as assignees and reporter", async () => {
        useCardCreateStore
            .getState()
            .open({ projectId: 'p1', listId: 'l1', position: 'a0', initialTitle: 'Pick people' })
        const { container, getByText, queryByText } = render(<CardCreateDialog projectId="p1" />, {
            wrapper,
        })
        const reporter = await waitFor(() => {
            const cell = q(container, 'form-field-reporter')
            if (!cell) throw new Error('no reporter cell')
            return cell
        })
        // The reporter menu closes on a pick; the assignee menu stays open for
        // the next one, so it goes second.
        fireEvent.click(getByText('Set reporter', { container: reporter }) as HTMLElement)
        await waitFor(() => expect(queryByText('Jonas Reyes')).toBeTruthy())
        expect(queryByText('Org Outsider')).toBeNull()
        fireEvent.click(getByText('Jonas Reyes'))
        await waitFor(() => expect(queryByText('Maya Kim')).toBeNull())

        const assignees = q(container, 'form-field-assignees') as HTMLElement
        fireEvent.click(getByText('Assign', { container: assignees }) as HTMLElement)
        await waitFor(() => expect(queryByText('Maya Kim')).toBeTruthy())
        expect(queryByText('Org Outsider')).toBeNull()
        fireEvent.click(getByText('Maya Kim'))

        fireEvent.click(q(container, 'form-wizard-next') as HTMLElement)
        await waitFor(() => expect(useCardCreateStore.getState().target).toBeNull())
        const card = h.stores.boards_cards.toArray.find(c => c.title === 'Pick people')
        expect(card).toMatchObject({ assignees: ['u1'], reporter: 'u2' })
    })

    it('creates a card of the picked type with its custom values and checklist rows', async () => {
        useCardCreateStore
            .getState()
            .open({ projectId: 'p1', listId: 'l1', position: 'a0', initialTitle: 'Login fails' })
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
