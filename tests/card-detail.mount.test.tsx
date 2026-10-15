// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { OverlayProvider } from '@tinycld/core/ui/overlay'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { BoardCardView } from '../tinycld/boards/types'

afterEach(cleanup)

// The per-child hooks carry their mutations, which need a query client.
const queryClient = new QueryClient()
const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

// useCardChildren reads everything hanging off a card as ONE include query
// anchored on the card row, and the per-child hooks select from it. Mounted
// against real TanStack DB collections so every include correlation compiles
// and emits; local-only collections have no sync, so this proves the query's
// shape, not the on-demand loading pbtsdb adds around it.

// Helpers live inside the hoisted block: vi.mock factories run when the
// mocked module is first imported, before any module-level const here.
const h = vi.hoisted(() => {
    const user = (id: string, name: string) => ({
        id,
        name,
        email: `${id}@test.local`,
        avatar: '',
        avatar_crop: '',
        avatar_color: '',
        avatar_emoji: '',
    })
    return {
        // c3 still carries a value for `retired`, a custom field its type no
        // longer has. c3 has only activity rows and c4 has no children, so
        // the card body mounts with near-empty sections.
        cards: [
            {
                id: 'c1',
                project: 'p1',
                title: 'One',
                number: 1,
                description: '',
                start: '',
                form: 'f-card',
                fields: {},
            },
            {
                id: 'c2',
                project: 'p1',
                title: 'Two',
                number: 2,
                description: '',
                start: '',
                form: 'f-card',
                fields: {},
            },
            {
                id: 'c3',
                project: 'p1',
                title: 'Three',
                number: 3,
                description: '',
                start: '',
                form: 'f-card',
                fields: { retired: 'kept' },
            },
            {
                id: 'c4',
                project: 'p1',
                title: 'Four',
                number: 4,
                description: '',
                start: '',
                form: '',
                fields: {},
            },
            // Typed cards whose type hides one section; no children either.
            {
                id: 'c5',
                project: 'p1',
                title: 'Five',
                number: 5,
                description: '',
                start: '',
                form: 'f-no-activity',
                fields: {},
            },
            {
                id: 'c6',
                project: 'p1',
                title: 'Six',
                number: 6,
                description: '',
                start: '',
                form: 'f-no-attachments',
                fields: {},
            },
        ],
        role: { canEdit: true, canComment: true, isOwner: false },
        items: [
            { id: 'i2', card: 'c1', title: 'second', is_done: false, position: 'a1' },
            { id: 'i1', card: 'c1', title: 'first', is_done: true, position: 'a0' },
            { id: 'i9', card: 'c2', title: 'other card', is_done: false, position: 'a0' },
        ],
        comments: [
            {
                id: 'k1',
                card: 'c1',
                author: 'u1',
                body: 'hi',
                parent: '',
                created: '2026-01-02',
                edited_at: '',
            },
            {
                id: 'k0',
                card: 'c1',
                author: 'u2',
                body: 'first',
                parent: '',
                created: '2026-01-01',
                edited_at: '',
            },
        ],
        attachments: [
            {
                id: 'a1',
                card: 'c1',
                uploaded_by: 'u1',
                file: 'x.png',
                name: '',
                size: 10,
                field: '',
                created: '',
            },
            // A file field's row: the field lists it, the Attachments section does not.
            {
                id: 'a2',
                card: 'c1',
                uploaded_by: 'u1',
                file: 'shot.png',
                name: '',
                size: 10,
                field: 'screenshot',
                created: '',
            },
        ],
        activity: [
            {
                id: 'e1',
                card: 'c1',
                actor: 'u1',
                kind: 'moved',
                from: 'a',
                to: 'b',
                created: '2026-01-03',
            },
            // c3's history: a moved row has no key; a link row ends in the other
            // card's key, so it is the one row with a key span.
            {
                id: 'e3',
                card: 'c3',
                actor: 'u1',
                kind: 'moved',
                from: 'a',
                to: 'b',
                created: '2026-01-05',
            },
            {
                id: 'e4',
                card: 'c3',
                actor: 'u1',
                kind: 'link_added',
                from: 'blocks',
                to: 'c4',
                created: '2026-01-06',
            },
            // A system row with no actor must survive the left join.
            {
                id: 'e0',
                card: 'c1',
                actor: '',
                kind: 'created',
                from: '',
                to: '',
                created: '2026-01-01',
            },
        ],
        watchers: [{ id: 'w1', project: 'p1', card: 'c1', user: 'u1' }],
        commentReactions: [
            { id: 'r1', project: 'p1', card: 'c1', comment: 'k1', user: 'u2', emoji: '👍' },
        ],
        links: [
            { id: 'ln1', source: 'c1', target: 'c2', type: 'blocks', created_by: 'u1' },
            { id: 'ln2', source: 'c2', target: 'c1', type: 'related', created_by: 'u1' },
        ],
        prLinks: [
            { id: 'pr2', card: 'c1', number: 2, unlinked: false },
            { id: 'pr1', card: 'c1', number: 1, unlinked: false },
            { id: 'pr3', card: 'c1', number: 3, unlinked: true },
        ],
        users: [user('u1', 'Maya Kim'), user('u2', 'Jonas Reyes')],
        user,
        // Renders counted by the probes the host's ui wraps two components in:
        // a card field, and the description's pinned header.
        renders: { TitleField: 0, DescriptionHeader: 0 },
    }
})

vi.mock('@tinycld/core/lib/auth', () => ({
    useAuth: () => ({ user: { id: 'u1' }, isLoggedIn: true }),
}))

vi.mock('../tinycld/boards/hooks/useProjectRole', () => ({
    useProjectRole: () => ({ role: null, isReady: true, ...h.role }),
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

// The reactions section's emoji picker loads FlashList, whose CommonJS build
// reaches the real react-native.
vi.mock('@shopify/flash-list', () => ({ FlashList: () => null }))

vi.mock('@tinycld/core/lib/forms/use-form-hosts', async () => {
    const { hostDefListSchema } = await import('@tinycld/core/lib/forms/host')
    const { default: hosts } = await import('../tinycld/boards/forms/hosts')
    const [def] = hostDefListSchema.parse(hosts)
    const host = {
        ...def,
        pkgSlug: 'boards',
        pkgName: 'Boards',
        ui: async () => {
            const { default: ui } = await import('../tinycld/boards/forms/ui')
            const { useCardDescription } = await import(
                '../tinycld/boards/forms/CardDescriptionContext'
            )
            const { createElement } = await import('react')
            type Props = Parameters<typeof ui.components.TitleField>[0]
            // The real components, each wrapped in a probe that counts its
            // renders. The header's probe reads the description's context the
            // way the header does, so it renders whenever the editor does.
            const TitleProbe = (props: Props) => {
                h.renders.TitleField += 1
                return createElement(ui.components.TitleField, props)
            }
            const Header = ui.pinned?.DescriptionField
            if (!Header) throw new Error('the card ui pins no description header')
            const HeaderProbe = (props: Props) => {
                useCardDescription()
                h.renders.DescriptionHeader += 1
                return createElement(Header, props)
            }
            return {
                ...ui,
                components: { ...ui.components, TitleField: TitleProbe },
                pinned: { ...ui.pinned, DescriptionField: HeaderProbe },
            }
        },
    }
    return { useFormHost: (key: string | undefined) => (key === host.key ? host : undefined) }
})

vi.mock('@tinycld/core/lib/pocketbase', async () => {
    const { BasicIndex, createCollection, localOnlyCollectionOptions } = await import(
        '@tanstack/db'
    )
    const mk = (id: string, initialData: { id: string }[]) => {
        // Auto-indexed like the app's real collections (core/lib/pocketbase.ts),
        // so the include joins use an index instead of scanning.
        const collection = createCollection({
            ...localOnlyCollectionOptions({ id, getKey: (r: { id: string }) => r.id, initialData }),
            autoIndex: 'eager',
            defaultIndexType: BasicIndex,
        })
        return Object.assign(collection, { fetchRelations: () => collection })
    }
    const { hostDefListSchema, defaultDefinitionFor } = await import('@tinycld/core/lib/forms/host')
    const { default: hosts } = await import('../tinycld/boards/forms/hosts')
    const [host] = hostDefListSchema.parse(hosts)
    const hiding = (id: string, key: string) => {
        const definition = defaultDefinitionFor(host)
        return {
            id,
            host: host.key,
            name: id,
            slug: id,
            is_default: false,
            archived: false,
            order: 1,
            definition: {
                ...definition,
                fields: definition.fields.map(f => (f.key === key ? { ...f, hidden: true } : f)),
            },
        }
    }
    const stores: Record<string, unknown> = {
        forms: mk('forms', [
            {
                id: 'f-card',
                host: host.key,
                name: 'Card',
                slug: 'card',
                is_default: true,
                archived: false,
                order: 0,
                definition: defaultDefinitionFor(host),
            },
            hiding('f-no-activity', 'activity'),
            hiding('f-no-attachments', 'attachments'),
        ]),
        boards_cards: mk('boards_cards', h.cards),
        boards_checklist_items: mk('boards_checklist_items', h.items),
        boards_comments: mk('boards_comments', h.comments),
        boards_attachments: mk('boards_attachments', h.attachments),
        boards_activity: mk('boards_activity', h.activity),
        boards_card_watchers: mk('boards_card_watchers', h.watchers),
        boards_comment_reactions: mk('boards_comment_reactions', h.commentReactions),
        boards_card_links: mk('boards_card_links', h.links),
        boards_pr_links: mk('boards_pr_links', h.prLinks),
        users: mk('users', h.users),
        // Read by the mounted card body; empty is enough.
        boards_project_members: mk('boards_project_members', []),
        boards_card_reactions: mk('boards_card_reactions', []),
        boards_projects: mk('boards_projects', []),
        boards_lists: mk('boards_lists', []),
        boards_labels: mk('boards_labels', []),
        boards_epics: mk('boards_epics', []),
        boards_sprints: mk('boards_sprints', []),
        boards_project_repos: mk('boards_project_repos', []),
        comment_mentions: mk('comment_mentions', []),
    }
    return {
        useStore: (...names: string[]) => names.map(n => stores[n]),
        // Core's user picker resolves its collection by name.
        collectionByName: (name: string) => stores[name],
        // The attachment thumbnails ask for a file token; signed out, they ask nothing.
        pb: {
            authStore: { isValid: false },
            files: { getURL: () => '', getToken: async () => '' },
        },
    }
})

import { useStore } from '@tinycld/core/lib/pocketbase'
import { CardDetail } from '~/tinycld/boards/components/detail/CardDetail'
import { useCardDetail } from '~/tinycld/boards/hooks/useCardDetail'
import { useCardWatch } from '~/tinycld/boards/hooks/useCardWatch'
import { useCommentReactions } from '~/tinycld/boards/hooks/useCommentReactions'
import { usePrLinks } from '~/tinycld/boards/hooks/usePrLinks'

// The host's `ui()` is a dynamic import of forms/ui, whose module graph takes
// most of a second to load cold when the whole suite runs in parallel: longer
// than `waitFor`'s default, measured at 0.8-1 s. Loading it once up front
// leaves the waits below measuring the hook, not the module load.
beforeAll(async () => {
    await import('../tinycld/boards/forms/ui')
})

test('useCardDetail returns the four sections for one card, in render order', async () => {
    const { result } = renderHook(() => useCardDetail('c1'), { wrapper })
    await waitFor(() => expect(result.current.isReady).toBe(true))

    expect(result.current.checklist.map(i => i.id)).toEqual(['i1', 'i2'])
    expect(result.current.comments.map(c => `${c.id}:${c.author.firstName}`)).toEqual([
        'k0:Jonas',
        'k1:Maya',
    ])
    expect(result.current.attachments.map(a => a.id)).toEqual(['a1'])
    expect(result.current.activity.map(e => e.actor?.firstName ?? '-')).toEqual(['-', 'Maya'])
})

test('the per-child hooks select from the same card query', async () => {
    const watch = renderHook(() => useCardWatch('p1', 'c1'), { wrapper })
    await waitFor(() => expect(watch.result.current.count).toBe(1))
    expect(watch.result.current.isWatching).toBe(true)

    const reactions = renderHook(() => useCommentReactions('p1', 'c1'), { wrapper })
    await waitFor(() => expect(reactions.result.current.reactionsFor('k1')).toHaveLength(1))
    expect(reactions.result.current.reactionsFor('k0')).toHaveLength(0)

    const prs = renderHook(() => usePrLinks('c1'), { wrapper })
    await waitFor(() => expect(prs.result.current.data.map(p => p.number)).toEqual([1, 2]))
})

test('the card query re-runs when the card changes', async () => {
    const { result, rerender } = renderHook(({ cardId }) => usePrLinks(cardId), {
        wrapper,
        initialProps: { cardId: 'c1' },
    })
    await waitFor(() => expect(result.current.data.map(p => p.number)).toEqual([1, 2]))

    rerender({ cardId: 'c2' })
    await waitFor(() => expect(result.current.data).toEqual([]))
})

const view = (id: string, title: string, number: number): BoardCardView => ({
    id,
    key: `OTTER-${number}`,
    number,
    listId: 'l1',
    position: 'a0',
    title,
    description: '',
    due: new Date(2030, 0, 15),
    dueHasTime: false,
    labels: [],
    assignees: [],
    priority: 'none',
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
})

const boardCards = [view('c3', 'Three', 3), view('c4', 'Four', 4)]

function mountDetail(card: BoardCardView) {
    return render(
        <QueryClientProvider client={new QueryClient()}>
            <OverlayProvider>
                <CardDetail
                    card={card}
                    variant="peek"
                    projectId="p1"
                    projectLabels={[]}
                    projectEpics={[]}
                    projectSprints={[]}
                    sprintsEnabled={false}
                    projectMembers={[]}
                    projectLists={[{ id: 'l1', name: 'To do' }]}
                    projectCards={boardCards}
                />
            </OverlayProvider>
        </QueryClientProvider>
    )
}

const q = (container: ParentNode, id: string) => container.querySelector(`[testID="${id}"]`)

/** The pressable a piece of text sits in, or null when it is bare. */
function pressableAround(container: HTMLElement, text: string) {
    const node = [...container.querySelectorAll('rn-text')].find(el => el.textContent === text)
    if (!node) throw new Error(`no text "${text}"`)
    return node.closest('rn-pressable')
}

describe('CardDetail', () => {
    test("renders the body as the card's form, one cell per field", async () => {
        h.role = { canEdit: true, canComment: true, isOwner: false }
        const { container } = mountDetail(view('c3', 'Three', 3))
        await waitFor(() => expect(q(container, 'card-form')).toBeTruthy())
        for (const key of ['title', 'description', 'due']) {
            expect(q(container, `form-field-${key}`)).toBeTruthy()
        }
    })

    test("the description's header is a pinned row of its own, above the body", async () => {
        h.role = { canEdit: true, canComment: true, isOwner: false }
        const { container } = mountDetail(view('c3', 'Three', 3))
        await waitFor(() => expect(q(container, 'form-pinned-description')).toBeTruthy())
        const pinned = q(container, 'form-pinned-description') as HTMLElement
        const cell = q(container, 'form-field-description') as HTMLElement
        expect(cell.contains(pinned)).toBe(false)
        expect(pinned.compareDocumentPosition(cell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        // Idle, the row shows the label; the toolbar takes its place while editing.
        expect(pinned.textContent).toBe('Description')
        expect(cell.textContent).not.toContain('Description')
        expect(cell.querySelector('[accessibilityLabel="Edit description"]')).toBeTruthy()
    })

    test('only a link row carries a key span; a moved row has none', async () => {
        h.role = { canEdit: true, canComment: true, isOwner: false }
        const { container } = mountDetail(view('c3', 'Three', 3))
        await waitFor(() => expect(q(container, 'boards-activity-link_added')).toBeTruthy())
        const moved = q(container, 'boards-activity-moved') as HTMLElement
        const link = q(container, 'boards-activity-link_added') as HTMLElement
        expect(q(moved, 'boards-card-key')).toBeNull()
        expect(q(link, 'boards-card-key')?.textContent).toBe('OTTER-4')
    })

    test('a viewer of a card with no description gets neither its header nor its body', async () => {
        h.role = { canEdit: false, canComment: false, isOwner: false }
        const { container } = mountDetail(view('c3', 'Three', 3))
        await waitFor(() => expect(q(container, 'form-field-activity')).toBeTruthy())
        expect(q(container, 'form-pinned-description')?.textContent).toBe('')
        expect(q(container, 'form-field-description')?.textContent).toBe('')
        expect(container.textContent).not.toContain('Description')
    })

    test("the description's editor re-renders only its own cells", async () => {
        h.role = { canEdit: true, canComment: true, isOwner: false }
        const { container } = mountDetail(view('c3', 'Three', 3))
        await waitFor(() => expect(q(container, 'form-pinned-description')).toBeTruthy())
        const before = { ...h.renders }
        // A new attachment re-renders the description's editor (it offers the
        // card's attachments to insert), and nothing above the form reads it.
        const [attachments] = useStore('boards_attachments') as unknown as [
            {
                insert: (row: (typeof h.attachments)[number]) => unknown
                delete: (id: string) => unknown
            },
        ]
        await act(async () => {
            attachments.insert({ ...h.attachments[0], id: 'a9', card: 'c3' })
        })
        await waitFor(() =>
            expect(h.renders.DescriptionHeader).toBeGreaterThan(before.DescriptionHeader)
        )
        expect(h.renders.TitleField).toBe(before.TitleField)
        // The stores outlive the test; later tests expect c3 bare.
        await act(async () => {
            attachments.delete('a9')
        })
    })

    test('a value whose field left the form keeps no cell', async () => {
        h.role = { canEdit: true, canComment: true, isOwner: false }
        const { container } = mountDetail(view('c3', 'Three', 3))
        await waitFor(() => expect(q(container, 'card-form')).toBeTruthy())
        expect(q(container, 'form-field-retired')).toBeNull()
        expect(container.textContent).not.toContain('kept')
    })

    test('a viewer sees bare values and nothing to add', async () => {
        h.role = { canEdit: true, canComment: true, isOwner: false }
        const editor = mountDetail(view('c4', 'Four', 4))
        // The settled answer for an editor first (the chip row offering the
        // empty sections), so the viewer's absence below is not just a
        // section that has not rendered yet.
        await waitFor(() => expect(q(editor.container, 'boards-section-chips')).toBeTruthy())
        cleanup()

        h.role = { canEdit: false, canComment: false, isOwner: false }
        const viewer = mountDetail(view('c4', 'Four', 4))
        await waitFor(() => expect(q(viewer.container, 'form-field-activity')).toBeTruthy())
        expect(q(viewer.container, 'boards-section-chips')).toBeNull()
        expect(viewer.queryByText('Attach file')).toBeNull()
        const due = q(viewer.container, 'form-field-due') as HTMLElement
        const label = [...due.querySelectorAll('rn-text')].at(-1)?.textContent ?? ''
        expect(label).not.toBe('')
        expect(pressableAround(due, label)).toBeNull()
    })

    test('a commenter on a read-only card keeps the composer and the reactions', async () => {
        h.role = { canEdit: false, canComment: true, isOwner: false }
        const { container } = mountDetail(view('c4', 'Four', 4))
        await waitFor(() => expect(q(container, 'form-field-activity')).toBeTruthy())
        expect(q(container, 'boards-comment-composer')).toBeTruthy()
        expect(container.querySelector('[accessibilityLabel="Add reaction"]')).toBeTruthy()
        expect(q(container, 'boards-section-chips')).toBeNull()
    })

    test('a type that hides activity hides the comment composer', async () => {
        h.role = { canEdit: true, canComment: true, isOwner: false }
        const { container } = mountDetail(view('c5', 'Five', 5))
        await waitFor(() => expect(q(container, 'boards-section-chips')).toBeTruthy())
        expect(q(container, 'form-field-activity')).toBeNull()
        expect(q(container, 'boards-comment-composer')).toBeNull()
    })

    test('a type that hides attachments offers no Attachments chip', async () => {
        h.role = { canEdit: true, canComment: true, isOwner: false }
        const { container } = mountDetail(view('c6', 'Six', 6))
        const chips = await waitFor(() => {
            const row = q(container, 'boards-section-chips')
            expect(row).toBeTruthy()
            return row as HTMLElement
        })
        expect(chips.textContent).toContain('Checklist')
        expect(chips.textContent).not.toContain('Attachments')
        expect(q(container, 'boards-comment-composer')).toBeTruthy()
    })

    test('dropping a file is enabled only while the type shows Attachments', async () => {
        h.role = { canEdit: true, canComment: true, isOwner: false }
        const hidden = mountDetail(view('c6', 'Six', 6))
        const zone = await waitFor(() => {
            const el = hidden.container.querySelector('[data-testid="card-drop-zone"]')
            expect(el).toBeTruthy()
            return el as HTMLElement
        })
        expect(zone.getAttribute('data-enabled')).toBe('false')
        // Not aria-disabled: that is inherited, so it would mark every control
        // in the card disabled for a reader who can still comment and react.
        expect(zone.getAttribute('aria-disabled')).toBeNull()
        cleanup()

        const shown = mountDetail(view('c3', 'Three', 3))
        const open = await waitFor(() => {
            const el = shown.container.querySelector('[data-testid="card-drop-zone"]')
            expect(el).toBeTruthy()
            return el as HTMLElement
        })
        expect(open.getAttribute('data-enabled')).toBe('true')
    })
})
