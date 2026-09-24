// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

// No vitest globals in this workspace, so testing-library's automatic
// afterEach cleanup never registers.
afterEach(cleanup)

// useBoardRows reads a board as ONE include query anchored on the project
// row. This mounts the real hook against real TanStack DB collections so the
// include correlations actually compile and emit — the builder rejects a
// malformed correlation only at query-build time, which a fixture that never
// runs the query would never reach. Local-only collections have no sync, so
// this proves the query's shape and the tree's identity sharing, not the
// on-demand loading that pbtsdb adds around it.

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
    const card = (id: string, list: string, position: string, overrides = {}) => ({
        id,
        project: 'p1',
        list,
        position,
        title: id,
        description: '',
        due: '',
        due_has_time: false,
        start: '',
        assignees: [] as string[],
        labels: [] as string[],
        created_by: 'u1',
        reporter: '',
        priority: 'none',
        estimate: 0,
        archived: false,
        archived_at: '',
        number: 1,
        checklist_total: 0,
        checklist_done: 0,
        comment_count: 0,
        attachment_count: 0,
        parent: '',
        subtask_total: 0,
        subtask_done: 0,
        epic: '',
        sprint: '',
        list_changed_at: '',
        created: '',
        updated: '',
        ...overrides,
    })
    return {
        projects: [
            {
                id: 'p1',
                name: 'Otters',
                slug: 'OTTER',
                next_number: 3,
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
            },
            // A second board: nothing of it may leak into p1's tree.
            {
                id: 'p2',
                name: 'Beavers',
                slug: 'BEAVER',
                next_number: 1,
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
            },
        ],
        lists: [
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
            {
                id: 'l2',
                project: 'p2',
                name: 'Elsewhere',
                position: 'a0',
                category: 'todo',
                wip_limit: 0,
                created: '',
                updated: '',
            },
        ],
        labels: [{ id: 'lb1', project: 'p1', name: 'bug', color: 'red', created: '', updated: '' }],
        members: [
            { id: 'm1', project: 'p1', user: 'u1', role: 'owner', created: '', updated: '' },
            { id: 'm2', project: 'p2', user: 'u1', role: 'owner', created: '', updated: '' },
        ],
        users: [user('u1', 'Maya Kim'), user('u2', 'Jonas Reyes')],
        user,
        card,
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
        const collection = createCollection(
            localOnlyCollectionOptions({
                id,
                getKey: (r: { id: string }) => r.id,
                initialData,
                // As collections.ts configures the real ones, so the joins
                // run against an index the way they do in the app.
                autoIndex: 'eager',
                defaultIndexType: BasicIndex,
            })
        )
        // A local collection has no relations to fetch; the view the hook
        // reads through is the collection itself.
        return Object.assign(collection, { fetchRelations: () => collection })
    }
    const stores: Record<string, unknown> = {
        boards_projects: mk('boards_projects', h.projects),
        boards_project_members: mk('boards_project_members', h.members),
        boards_lists: mk('boards_lists', h.lists),
        boards_cards: mk('boards_cards', [
            h.card('c1', 'l1', 'a0', { labels: ['lb1'], assignees: ['u2'] }),
            h.card('c2', 'l1', 'a1', { archived: true }),
            h.card('c9', 'l2', 'a0', { project: 'p2' }),
        ]),
        boards_labels: mk('boards_labels', h.labels),
        boards_epics: mk('boards_epics', []),
        boards_sprints: mk('boards_sprints', []),
        boards_card_reactions: mk('boards_card_reactions', []),
        users: mk('users', h.users),
    }
    return {
        useStore: (...names: string[]) => names.map(n => stores[n]),
    }
})

import { useBoardContent, useBoardRows } from '~/tinycld/boards/hooks/useActiveBoard'

test('useBoardRows resolves one board with its children, by id or by slug', async () => {
    const byId = renderHook(() => useBoardRows({ id: 'p1' }))
    await waitFor(() => expect(byId.result.current.rows?.project.id).toBe('p1'))
    const rows = byId.result.current.rows
    expect(rows?.lists.map(l => l.id)).toEqual(['l1'])
    expect(rows?.cards.map(c => c.id).sort()).toEqual(['c1', 'c2'])
    expect(rows?.labels.map(l => l.id)).toEqual(['lb1'])
    expect(rows?.members.map(m => m.user.id)).toEqual(['u1'])

    const bySlug = renderHook(() => useBoardRows({ segment: 'otter-2', slug: 'OTTER' }))
    await waitFor(() => expect(bySlug.result.current.rows?.project.id).toBe('p1'))
})

test('useBoardContent builds the tree and keeps its identity across rerenders', async () => {
    const { result, rerender } = renderHook(() => useBoardContent('p1'))
    await waitFor(() => expect(result.current.project).not.toBeNull())

    const project = result.current.project
    expect(project?.lists[0]?.cards.map(c => c.id)).toEqual(['c1'])
    expect(project?.lists[0]?.cards[0]?.labels.map(l => l.name)).toEqual(['bug'])
    // u2 is not on the roster but is a synced user, so the assignee resolves.
    expect(project?.lists[0]?.cards[0]?.assignees[0]?.firstName).toBe('Jonas')
    expect(project?.archivedCards.map(c => c.id)).toEqual(['c2'])
    expect(project?.members.map(m => m.id)).toEqual(['u1'])

    rerender()
    expect(result.current.project).toBe(project)
})
