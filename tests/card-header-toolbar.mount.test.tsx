// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from '@testing-library/react'
import * as formsOfHost from '@tinycld/core/lib/forms/use-forms-of-host'
import { OverlayProvider } from '@tinycld/core/ui/overlay'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CardHeaderToolbar } from '../tinycld/boards/components/detail/CardHeaderToolbar'
import type { BoardCardView, BoardListView, BoardProject } from '../tinycld/boards/types'

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

// Every collection is an empty local-only store: the toolbar only needs its
// queries to run, and the assertion is about which of them it starts.
const h = vi.hoisted(() => ({
    stores: new Map<string, unknown>(),
}))

vi.mock('@tinycld/core/lib/auth', () => ({
    useAuth: () => ({ user: { id: 'u1' }, isLoggedIn: true }),
}))

// The shared lucide stub only binds the icons it lists by name; this toolbar
// draws a few it does not, so any unlisted icon draws nothing.
vi.mock('lucide-react-native', async importOriginal => {
    const actual = await importOriginal<Record<string, unknown>>()
    const Icon = () => null
    return new Proxy(actual, {
        get: (target, prop) =>
            Reflect.get(target, prop) ?? (/^[A-Z]/.test(String(prop)) ? Icon : undefined),
        has: () => true,
    })
})

vi.mock('@tinycld/core/lib/pocketbase', async () => {
    const { BasicIndex, createCollection, localOnlyCollectionOptions } = await import(
        '@tanstack/db'
    )
    const store = (name: string) => {
        const existing = h.stores.get(name)
        if (existing) return existing
        const collection = createCollection({
            ...localOnlyCollectionOptions({
                id: name,
                getKey: (r: { id: string }) => r.id,
                initialData: [],
            }),
            autoIndex: 'eager',
            defaultIndexType: BasicIndex,
        })
        const made = Object.assign(collection, { fetchRelations: () => collection })
        h.stores.set(name, made)
        return made
    }
    return { useStore: (...names: string[]) => names.map(store) }
})

const card: BoardCardView = {
    id: 'c1',
    key: 'OTTER-7',
    number: 7,
    listId: 'l1',
    position: 'a0',
    title: 'Ship it',
    description: '',
    dueHasTime: false,
    labels: [],
    assignees: [],
    priority: 'high',
    listCategory: 'todo',
    created: '',
    listChangedAt: '',
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    attachmentCount: 0,
    parent: '',
    parentKey: '',
    subtaskTotal: 0,
    subtaskDone: 0,
    epic: null,
    sprint: null,
}

const list: BoardListView = {
    id: 'l1',
    name: 'To do',
    position: 'a0',
    category: 'todo',
    cards: [card],
    totalCount: 1,
}

const project: BoardProject = {
    id: 'p1',
    name: 'Otters',
    slug: 'OTTER',
    color: '#8b5cf6',
    autoArchiveDays: 0,
    agingDays: 0,
    members: [],
    lists: [list],
    listOrder: [{ id: 'l1', position: 'a0' }],
    cardTotal: 1,
    archivedCards: [],
    labels: [],
    epics: [],
    sprints: [],
    sprintsEnabled: false,
    sprintLengthDays: 14,
    sprintAutoStart: false,
    sprintAutoComplete: false,
    sprintRollover: 'next',
    unplacedCards: [],
}

function wrapper({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={new QueryClient()}>
            <OverlayProvider>{children}</OverlayProvider>
        </QueryClientProvider>
    )
}

function mountToolbar(canEdit: boolean) {
    return render(
        <CardHeaderToolbar
            project={project}
            entry={{ card, list }}
            canEdit={canEdit}
            onDismiss={() => {}}
        />,
        { wrapper }
    )
}

describe('CardHeaderToolbar', () => {
    it('runs no card-type query for a viewer', () => {
        const spy = vi.spyOn(formsOfHost, 'useFormsOfHost')
        mountToolbar(false)
        expect(spy).not.toHaveBeenCalled()
    })

    it('runs the card-type query for an editor', () => {
        const spy = vi.spyOn(formsOfHost, 'useFormsOfHost')
        mountToolbar(true)
        expect(spy).toHaveBeenCalled()
    })
})
