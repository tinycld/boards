// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { log } from '@tinycld/core/lib/logger'
import { AUTO_PATCH_DELAY_MS } from '@tinycld/core/ui/forms'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

// The card's edit form over local-only collections: the forms store holds the
// default "Card" type and an ARCHIVED "Bug" type that adds a Severity select;
// c1 is a bug with a severity, c2 has no type yet (the quick composer's window
// before the server fills the default).

type StoreRow = { id: string } & Record<string, unknown>

const h = vi.hoisted(() => ({
    stores: {} as Record<string, { get: (id: string) => StoreRow | undefined }>,
}))

vi.mock('@tinycld/core/lib/auth', () => ({
    useAuth: () => ({ user: { id: 'u1' }, isLoggedIn: true }),
}))

vi.mock('../tinycld/boards/components/BoardPresenceProvider', () => ({
    useBoardPresenceContext: () => ({
        doc: null,
        awareness: null,
        peers: [],
        isReady: false,
        isConnected: false,
        canEditDoc: false,
        identity: null,
    }),
}))

// The host's UI module loads every section, and the reactions section's emoji
// picker loads FlashList, whose CommonJS build reaches the real react-native.
vi.mock('@shopify/flash-list', () => ({ FlashList: () => null }))

vi.mock('@tinycld/core/lib/forms/use-form-hosts', async () => {
    const { hostDefListSchema } = await import('@tinycld/core/lib/forms/host')
    const { default: hosts } = await import('../tinycld/boards/forms/hosts')
    const [def] = hostDefListSchema.parse(hosts)
    const host = {
        ...def,
        pkgSlug: 'boards',
        pkgName: 'Boards',
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
        required: false,
        hidden: false,
        options: [
            { value: 'low', label: 'Low' },
            { value: 'high', label: 'High' },
        ],
    }
    const form = (
        id: string,
        name: string,
        order: number,
        archived: boolean,
        definition: unknown
    ) => ({
        id,
        host: host.key,
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
    const card = (id: string, formId: string, fields: Record<string, unknown>) => ({
        id,
        project: 'p1',
        list: 'l1',
        title: id,
        description: '',
        start: '',
        form: formId,
        fields,
    })
    Object.assign(h.stores, {
        forms: mk('forms', [
            form('f-card', 'Card', 0, false, base),
            form('f-bug', 'Bug', 1, true, { ...base, fields: [...base.fields, severity] }),
        ]),
        boards_cards: mk('boards_cards', [
            card('c1', 'f-bug', { severity: 'high' }),
            card('c2', '', {}),
            card('c3', 'gone', {}),
        ]),
    })
    return { useStore: (...names: string[]) => names.map(n => h.stores[n]) }
})

import { useCardForm } from '../tinycld/boards/forms/use-card-form'

function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

// The host's `ui()` is a dynamic import of forms/ui, whose module graph takes
// most of a second to load cold when the whole suite runs in parallel: longer
// than `waitFor`'s default, measured at 0.8-1 s. Loading it once up front
// leaves the waits below measuring the hook, not the module load.
beforeAll(async () => {
    await import('../tinycld/boards/forms/ui')
})

describe('useCardForm', () => {
    it('renders the card with the form it points at, archived or not', async () => {
        const { result } = renderHook(() => useCardForm('c1'), { wrapper })
        await waitFor(() => expect(result.current.isReady).toBe(true))
        expect(result.current.edit.definition?.fields.some(f => f.key === 'severity')).toBe(true)
        expect(result.current.edit.form.getValues('severity')).toBe('high')
    })

    it('falls back to the default form while the row has none', async () => {
        const { result } = renderHook(() => useCardForm('c2'), { wrapper })
        await waitFor(() => expect(result.current.isReady).toBe(true))
        expect(result.current.edit.definition?.fields.some(f => f.key === 'severity')).toBe(false)
    })

    it('opens a card whose form is gone on the default and logs once', async () => {
        const warn = vi.spyOn(log, 'warn')
        try {
            const { result } = renderHook(() => useCardForm('c3'), { wrapper })
            await waitFor(() => expect(result.current.isReady).toBe(true))
            const fallbackWarns = warn.mock.calls.filter(c => c[0] === 'boards.card-form')
            expect(fallbackWarns).toHaveLength(1)
            expect(fallbackWarns[0][2]).toEqual({ cardId: 'c3', form: 'gone' })
        } finally {
            warn.mockRestore()
        }
    })

    it('saves a custom field change through the card update and marks it clean', async () => {
        const { result } = renderHook(() => useCardForm('c1'), { wrapper })
        await waitFor(() => expect(result.current.isReady).toBe(true))
        vi.useFakeTimers()
        try {
            act(() => result.current.edit.form.setValue('severity', 'low', { shouldDirty: true }))
            await act(async () => {
                await vi.advanceTimersByTimeAsync(AUTO_PATCH_DELAY_MS)
            })
            expect(h.stores.boards_cards.get('c1')?.fields).toEqual({ severity: 'low' })
            expect(result.current.edit.form.formState.isDirty).toBe(false)
        } finally {
            vi.useRealTimers()
        }
    })
})
