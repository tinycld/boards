// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { defaultDefinitionFor, hostDefListSchema } from '@tinycld/core/lib/forms/host'
import { applyDefaults, type EvalContext, evaluate } from '@tinycld/core/lib/forms/logic'
import { buildSchema } from '@tinycld/core/lib/forms/values'
import type { FormHost } from '@tinycld/core/lib/packages/derive-form-hosts'
import { useForm } from '@tinycld/core/ui/form'
import { FormRenderer, useHostUi, useSchemaRefResolver } from '@tinycld/core/ui/forms'
import { OverlayProvider } from '@tinycld/core/ui/overlay'
import { afterEach, describe, expect, it, vi } from 'vitest'
import hosts from '../tinycld/boards/forms/hosts'

afterEach(cleanup)

// The form builder's Preview renders a card type the way core's PreviewDialog
// does: a create-mode form with neither of the card's providers above it (no
// card, no board). The card's own fields must still draw their inputs there.

vi.mock('@tinycld/core/lib/auth', () => ({
    useAuth: () => ({ user: { id: 'u1' }, isLoggedIn: true }),
}))

vi.mock('@tinycld/core/components/workspace/useBreakpoint', () => ({
    useBreakpoint: () => 'desktop',
}))

// The host's UI module loads every section, and the reactions section's emoji
// picker loads FlashList, whose CommonJS build reaches the real react-native.
vi.mock('@shopify/flash-list', () => ({ FlashList: () => null }))

vi.mock('@tinycld/core/lib/pocketbase', async () => {
    const { createCollection, localOnlyCollectionOptions } = await import('@tanstack/db')
    const users = createCollection(
        localOnlyCollectionOptions({
            id: 'users',
            getKey: (r: { id: string }) => r.id,
            initialData: [],
        })
    )
    return {
        useStore: (...names: string[]) => names.map(() => users),
        // Core's user picker resolves its collection by name.
        collectionByName: () => users,
    }
})

const [def] = hostDefListSchema.parse(hosts)
const host: FormHost = {
    ...def,
    pkgSlug: 'boards',
    ui: async () => (await import('../tinycld/boards/forms/ui')).default,
}
const definition = defaultDefinitionFor(def)
const context: EvalContext = { today: '2026-01-15', userId: 'u1' }

/** PreviewDialog's body, over the card host's default form. */
function Preview({ onSubmit }: { onSubmit: (values: Record<string, unknown>) => void }) {
    const ui = useHostUi(host)
    const defaults = applyDefaults(definition, context)
    const { schemaRef, resolver } = useSchemaRefResolver(
        buildSchema(definition, host, evaluate(definition, defaults, context))
    )
    const form = useForm({ resolver, defaultValues: defaults })
    if (!ui) return null
    return (
        <FormRenderer
            host={host}
            ui={ui}
            definition={definition}
            layout="wizard"
            form={form}
            context={context}
            schemaRef={schemaRef}
            submitLabel="Done"
            onSubmit={() => onSubmit(form.getValues())}
        />
    )
}

const q = (container: ParentNode, id: string) =>
    container.querySelector(`[testID="${id}"]`) as HTMLElement | null

describe('the card type in the builder preview', () => {
    it('draws the title input and submits what is typed, with no card or board behind it', async () => {
        const onSubmit = vi.fn()
        const { container } = render(
            <QueryClientProvider client={new QueryClient()}>
                <OverlayProvider>
                    <Preview onSubmit={onSubmit} />
                </OverlayProvider>
            </QueryClientProvider>
        )
        const title = await waitFor(() => {
            const input = q(container, 'form-input-title')
            if (!input) throw new Error('no title input')
            return input
        })
        // A picker field offers its picker, not an empty cell.
        expect(q(container, 'form-field-estimate')?.textContent).toContain('Set estimate')

        fireEvent.input(title, { target: { value: 'Preview card' } })
        fireEvent.click(q(container, 'form-wizard-next') as HTMLElement)
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
        expect(onSubmit.mock.calls[0][0]).toMatchObject({ title: 'Preview card' })
    })
})
