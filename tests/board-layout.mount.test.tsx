// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { setResolvedAddress } from '@tinycld/core/lib/server-address'
import { OverlayProvider } from '@tinycld/core/ui/overlay'
import { createElement, Fragment, type ReactNode, useEffect, useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBoardPresenceContext } from '../tinycld/boards/components/BoardPresenceProvider'

afterEach(cleanup)

// The board layout route renders the board ONCE — its queries, its room and
// its chrome — and lays the card children's Stack over it. Mounted here over
// local collections, with the router's components recorded rather than run:
// the children are routes of their own, and what is under test is the layout.

const h = vi.hoisted(() => ({
    params: {} as Record<string, string>,
    redirects: [] as unknown[],
    stacks: 0,
    sockets: [] as string[],
    // What each card child (a peek, a page) read from the room it sits in.
    docs: [] as (object | null)[],
    // How many times a card child mounted: a remount would lose the child
    // route a reader had open on the board.
    childMounts: 0,
    // The boards stack this layout's route ('pl') sits in, and whether the
    // route is focused: leaving Boards blurs it without covering it.
    routes: [{ key: 'pl', name: '[boardSlug]' }] as { key: string; name: string }[],
    isFocused: true,
    navListeners: new Set<() => void>(),
}))

const PL = { key: 'pl', name: '[boardSlug]' }
const OTTER = { key: 'otter', name: '[boardSlug]' }

function setNavigation(next: { routes?: { key: string; name: string }[]; isFocused?: boolean }) {
    act(() => {
        if (next.routes) h.routes = next.routes
        if (next.isFocused !== undefined) h.isFocused = next.isFocused
        for (const listener of h.navListeners) listener()
    })
}

function subscribeToNavigation(listener: () => void) {
    h.navListeners.add(listener)
    return () => h.navListeners.delete(listener)
}

// A card child's view of the room: the document its description binds to.
function RoomProbe() {
    const { doc } = useBoardPresenceContext()
    h.docs.push(doc)
    useEffect(() => {
        h.childMounts += 1
    }, [])
    return null
}

vi.mock('expo-router', () => {
    const router = {
        push: vi.fn(),
        replace: vi.fn(),
        back: vi.fn(),
        setParams: vi.fn(),
        navigate: vi.fn(),
        dismissTo: vi.fn(),
        canGoBack: () => true,
    }
    const Stack = Object.assign(
        () => {
            h.stacks += 1
            // Two children, as a peek with a page stacked on it: the layout's
            // Stack renders its routes inside the room.
            return createElement(
                Fragment,
                null,
                createElement(RoomProbe, { key: 'peek' }),
                createElement(RoomProbe, { key: 'page' })
            )
        },
        { Screen: () => null }
    )
    return {
        Stack,
        Redirect: ({ href }: { href: unknown }) => {
            h.redirects.push(href)
            return null
        },
        useLocalSearchParams: () => h.params,
        useRouter: () => router,
        // Focus is immediate and permanent here: one route, on screen.
        useFocusEffect: (effect: () => undefined | (() => void)) => {
            useEffect(effect, [effect])
        },
        useNavigation: () => ({ isFocused: () => h.isFocused, addListener: () => () => {} }),
        useIsFocused: () => useSyncExternalStore(subscribeToNavigation, () => h.isFocused),
        useRoute: () => ({ key: 'pl', name: '[boardSlug]' }),
        useGlobalSearchParams: () => h.params,
        usePathname: () => '/a/boards/PL',
        useSegments: () => [],
    }
})

// The boards stack's state, as the layout reads it to know whether a later
// board covers it.
vi.mock('expo-router/react-navigation', () => ({
    useNavigationState: <T,>(selector: (state: { routes: typeof h.routes }) => T) =>
        useSyncExternalStore(subscribeToNavigation, () => selector({ routes: h.routes })),
}))

vi.mock('@tinycld/core/lib/auth', () => ({
    useAuth: () => ({ user: { id: 'u1', name: 'Maya Kim' }, isLoggedIn: true }),
}))

// FlashList's CommonJS build reaches the real react-native.
vi.mock('@shopify/flash-list', () => ({ FlashList: () => null }))

// The shared stub's default export does not survive ESM interop as a
// component, and the board's wash renders `<Svg>` by its default import.
vi.mock('react-native-svg', () => {
    const Nothing = () => null
    return {
        default: Nothing,
        Svg: Nothing,
        Defs: Nothing,
        LinearGradient: Nothing,
        Rect: Nothing,
        Stop: Nothing,
        Path: Nothing,
        Circle: Nothing,
        G: Nothing,
    }
})

// Every icon the chrome draws: the shared stub's, plus a blank for any it does
// not name yet (the view toggle's newer glyphs).
vi.mock('lucide-react-native', async importOriginal => {
    const actual = await importOriginal<Record<string, unknown>>()
    const Icon = () => null
    const isIcon = (name: string | symbol) => typeof name === 'string' && /^[A-Z]/.test(name)
    return new Proxy(actual, {
        get: (target, name) =>
            name in target ? target[name as string] : isIcon(name) ? Icon : undefined,
        has: (target, name) => name in target || isIcon(name),
    })
})

// The app registers boards' card host from the manifest at boot; here it is
// read straight from the package's host definitions.
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
    const rows: Record<string, { id: string }[]> = {
        boards_projects: [
            {
                id: 'p1',
                name: 'Planning',
                slug: 'PL',
                next_number: 2,
                color: '#8b5cf6',
                visibility: 'private',
                created_by: 'u1',
                archived: false,
                auto_archive_days: 0,
                aging_days: 0,
                sprints_enabled: false,
                sprint_length_days: 0,
                sprint_auto_start: false,
                sprint_auto_complete: false,
                sprint_rollover: 'next',
                next_sprint_number: 0,
                created: '',
                updated: '',
            } as { id: string },
        ],
        boards_project_members: [
            { id: 'm1', project: 'p1', user: 'u1', role: 'owner', created: '', updated: '' },
        ] as { id: string }[],
        boards_lists: [
            {
                id: 'l1',
                project: 'p1',
                name: 'To do',
                position: 'a0',
                category: 'todo',
                wip_limit: 0,
                created: '',
                updated: '',
            },
        ] as { id: string }[],
        users: [
            {
                id: 'u1',
                name: 'Maya Kim',
                email: 'u1@test.local',
                avatar: '',
                avatar_crop: '',
                avatar_color: '',
                avatar_emoji: '',
            },
        ] as { id: string }[],
    }
    // Every collection the board reaches, empty unless seeded above, built on
    // first use so the test does not have to list what the chrome happens to
    // query today.
    const stores = new Map<string, unknown>()
    const store = (id: string) => {
        if (!stores.has(id)) {
            const collection = createCollection({
                ...localOnlyCollectionOptions({
                    id: `board-layout-${id}`,
                    getKey: (r: { id: string }) => r.id,
                    initialData: rows[id] ?? [],
                }),
                autoIndex: 'eager',
                defaultIndexType: BasicIndex,
            })
            stores.set(id, Object.assign(collection, { fetchRelations: () => collection }))
        }
        return stores.get(id)
    }
    return {
        useStore: (...names: string[]) => names.map(store),
        pb: { authStore: { token: '', record: { id: 'u1' } } },
    }
})

// One socket per room: counting the sockets opened is counting the rooms.
class RecordingSocket {
    static OPEN = 1
    readyState = 0
    binaryType = 'arraybuffer'
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onmessage: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(url: string) {
        h.sockets.push(url)
    }
    send() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
}
vi.stubGlobal('WebSocket', RecordingSocket)

// The tab title asks the server for the org's name; no server answers here.
vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))

const queryClient = new QueryClient()

function Providers({ children }: { children: ReactNode }) {
    return createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(OverlayProvider, null, children)
    )
}

async function mountLayout(boardSlug: string) {
    h.params = { boardSlug }
    // What the app's root gate resolves before any screen mounts.
    setResolvedAddress('http://localhost:7201')
    // The list view: the canvas's drag-and-drop library is a native module
    // the unit tests do not load, and the view is not what is under test.
    const { useBoardsUIStore } = await import('../tinycld/boards/stores/boards-ui-store')
    useBoardsUIStore.getState().setViewMode('p1', 'list')
    const { default: BoardLayout } = await import('../tinycld/boards/screens/[boardSlug]/_layout')
    return render(createElement(Providers, null, createElement(BoardLayout)))
}

describe('the board layout route', () => {
    afterEach(() => {
        h.redirects = []
        h.stacks = 0
        h.sockets = []
        h.docs = []
        h.childMounts = 0
        h.routes = [PL]
        h.isFocused = true
    })

    it('mounts the board chrome, the child stack and exactly one room', async () => {
        const view = await mountLayout('PL')
        // The react-native stub renders a testID as a plain `testid` attribute.
        const byTestId = (id: string) => view.container.querySelectorAll(`[testid="${id}"]`)

        await waitFor(() => expect(byTestId('boards-board-room')).toHaveLength(1))
        expect(byTestId('boards-board-name')[0]?.textContent).toContain('Planning')
        expect(byTestId('boards-board-parked')).toHaveLength(0)
        expect(h.stacks).toBeGreaterThan(0)
        await waitFor(() => expect(h.sockets).toHaveLength(1))
        expect(h.sockets[0]).toContain('p1')
    })

    it('shares the layout’s room and document with every card child', async () => {
        await mountLayout('PL')

        // Each render of the two probes appends a pair; the room's document
        // arrives after the first, so compare the latest pair.
        await waitFor(() => expect(h.docs.at(-1)).not.toBeNull())
        const [peek, page] = h.docs.slice(-2)
        expect(peek).toBe(page)
        expect(h.sockets).toHaveLength(1)
    })

    // Another board pushed over this one leaves it mounted beneath. Parked, it
    // holds nothing: no room (so no socket), no board view and no queries.
    it('parks a board covered by a later board: a placeholder, no room and no board view', async () => {
        h.routes = [PL, OTTER]
        const view = await mountLayout('PL')
        const byTestId = (id: string) => view.container.querySelectorAll(`[testid="${id}"]`)

        await waitFor(() => expect(byTestId('boards-board-parked')).toHaveLength(1))
        expect(byTestId('boards-board-room')).toHaveLength(0)
        expect(byTestId('boards-board-name')).toHaveLength(0)
        expect(h.sockets).toHaveLength(0)
        expect(h.docs.every(doc => doc === null)).toBe(true)
    })

    // Leaving Boards for another package blurs the board without covering it:
    // it stays as it was — room, view and the card a reader was writing in —
    // for when they come back.
    it('keeps a blurred board that no board covers live', async () => {
        const view = await mountLayout('PL')
        const byTestId = (id: string) => view.container.querySelectorAll(`[testid="${id}"]`)
        await waitFor(() => expect(byTestId('boards-board-room')).toHaveLength(1))
        await waitFor(() => expect(h.sockets).toHaveLength(1))
        const mounts = h.childMounts

        setNavigation({ isFocused: false })
        expect(byTestId('boards-board-parked')).toHaveLength(0)
        expect(byTestId('boards-board-room')).toHaveLength(1)

        setNavigation({ isFocused: true })
        expect(byTestId('boards-board-room')).toHaveLength(1)
        expect(h.sockets).toHaveLength(1)
        expect(h.childMounts).toBe(mounts)
    })

    it('keeps the card children mounted across cover and uncover', async () => {
        const view = await mountLayout('PL')
        const byTestId = (id: string) => view.container.querySelectorAll(`[testid="${id}"]`)
        await waitFor(() => expect(byTestId('boards-board-room')).toHaveLength(1))
        await waitFor(() => expect(h.sockets).toHaveLength(1))
        const mounts = h.childMounts
        expect(mounts).toBeGreaterThan(0)

        setNavigation({ routes: [PL, OTTER], isFocused: false })
        await waitFor(() => expect(byTestId('boards-board-parked')).toHaveLength(1))
        expect(byTestId('boards-board-room')).toHaveLength(0)

        setNavigation({ routes: [PL], isFocused: true })
        await waitFor(() => expect(byTestId('boards-board-room')).toHaveLength(1))
        expect(byTestId('boards-board-parked')).toHaveLength(0)
        // The room was left when covered and is joined again when uncovered.
        await waitFor(() => expect(h.sockets).toHaveLength(2))
        // The children's Stack was never torn down, so the card the reader had
        // open on this board is still its child route.
        expect(h.childMounts).toBe(mounts)
    })

    // The old spelling put the key where the board goes.
    it('redirects the old /a/boards/PL-12 to /a/boards/PL/PL-12', async () => {
        await mountLayout('pl-12')

        await waitFor(() => expect(h.redirects).toHaveLength(1))
        expect(String(h.redirects[0])).toMatch(/\/boards\/PL\/PL-12$/)
        expect(h.stacks).toBe(0)
    })
})
