// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import * as logic from '@tinycld/core/lib/forms/logic'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

// The card's edit form over local-only collections: c1 is a bug whose type has
// one rule, reading only `severity`.

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
            form('f-bug', 'Bug', 1, true, {
                ...base,
                fields: [...base.fields, severity],
                rules: [
                    {
                        key: 'high_severity',
                        match: 'all',
                        when: [{ field: 'severity', op: 'is', value: 'high' }],
                        actions: [{ action: 'hide', field: 'severity' }],
                    },
                ],
            }),
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
import { useFieldVisibility } from '../tinycld/boards/forms/use-field-visibility'

function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

beforeAll(async () => {
    await import('../tinycld/boards/forms/ui')
})

const context = { today: '2026-01-01', userId: 'u1' }

describe('useFieldVisibility', () => {
    it('re-evaluates only when a field the rules read changes', async () => {
        const evaluate = vi.spyOn(logic, 'evaluate')
        try {
            const { result } = renderHook(
                () => {
                    const { edit } = useCardForm('c1')
                    return { edit, isVisible: useFieldVisibility(edit, context) }
                },
                { wrapper }
            )
            await waitFor(() => expect(result.current.isVisible('severity')).toBe(false))
            const baseline = evaluate.mock.calls.length

            act(() => result.current.edit.form.setValue('title', 'x'))
            expect(evaluate.mock.calls.length).toBe(baseline)

            act(() => result.current.edit.form.setValue('severity', 'low'))
            expect(evaluate.mock.calls.length).toBeGreaterThan(baseline)
            expect(result.current.isVisible('severity')).toBe(true)
        } finally {
            evaluate.mockRestore()
        }
    })
})
