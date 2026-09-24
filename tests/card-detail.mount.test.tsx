// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

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
        cards: [
            { id: 'c1', project: 'p1', title: 'One', number: 1 },
            { id: 'c2', project: 'p1', title: 'Two', number: 2 },
        ],
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
            { id: 'ln2', source: 'c2', target: 'c1', type: 'relates', created_by: 'u1' },
        ],
        prLinks: [
            { id: 'pr2', card: 'c1', number: 2, unlinked: false },
            { id: 'pr1', card: 'c1', number: 1, unlinked: false },
            { id: 'pr3', card: 'c1', number: 3, unlinked: true },
        ],
        users: [user('u1', 'Maya Kim'), user('u2', 'Jonas Reyes')],
        user,
    }
})

vi.mock('@tinycld/core/lib/auth', () => ({
    useAuth: () => ({ user: { id: 'u1' }, isLoggedIn: true }),
}))

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
    const stores: Record<string, unknown> = {
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
    }
    return {
        useStore: (...names: string[]) => names.map(n => stores[n]),
    }
})

import { useCardDetail } from '~/tinycld/boards/hooks/useCardDetail'
import { useCardWatch } from '~/tinycld/boards/hooks/useCardWatch'
import { useCommentReactions } from '~/tinycld/boards/hooks/useCommentReactions'
import { usePrLinks } from '~/tinycld/boards/hooks/usePrLinks'

test('useCardDetail returns the four sections for one card, in render order', async () => {
    const { result } = renderHook(() => useCardDetail('c1'), { wrapper })
    await waitFor(() => expect(result.current.isReady).toBe(true))

    expect(result.current.checklist.map(i => i.id)).toEqual(['i1', 'i2'])
    expect(result.current.comments.map(c => `${c.id}:${c.author.firstName}`)).toEqual([
        'k0:Jonas',
        'k1:Maya',
    ])
    expect(result.current.attachments.map(a => a.uploadedBy.firstName)).toEqual(['Maya'])
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
