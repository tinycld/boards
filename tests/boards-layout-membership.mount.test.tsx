// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The boards section's layout watches the user's memberships (useMembershipSync)
// for as long as the section is open, and only then: membership rows file every
// board the user belongs to, so an app-wide watcher held all of them for the
// whole session. These tests mount the layout over local collections and drive
// a revocation through the membership collection.

const h = vi.hoisted(() => ({
    evicted: [] as { collection: string; ids: readonly string[] }[],
    stores: {} as Record<string, unknown>,
}))

vi.mock('@tinycld/core/lib/auth', () => ({
    useAuth: () => ({ user: { id: 'u1' }, isLoggedIn: true }),
}))

vi.mock('@tinycld/core/lib/pocketbase', async () => {
    const { createCollection, localOnlyCollectionOptions } = await import('@tanstack/db')
    const mk = (name: string, initialData: { id: string; project?: string; user?: string }[]) =>
        Object.assign(
            createCollection(
                localOnlyCollectionOptions({
                    id: name,
                    getKey: (row: { id: string }) => row.id,
                    initialData,
                })
            ),
            {
                evict: async (ids: readonly string[]) => {
                    h.evicted.push({ collection: name, ids })
                },
            }
        )
    h.stores = {
        boards_project_members: mk('boards_project_members', [
            { id: 'm1', project: 'p1', user: 'u1' },
            { id: 'm2', project: 'p2', user: 'u1' },
        ]),
        boards_projects: mk('boards_projects', [{ id: 'p1' }, { id: 'p2' }]),
        boards_lists: mk('boards_lists', [
            { id: 'l1', project: 'p1' },
            { id: 'l2', project: 'p2' },
        ]),
        boards_cards: mk('boards_cards', [{ id: 'c9', project: 'p2' }]),
        boards_labels: mk('boards_labels', []),
        boards_checklist_items: mk('boards_checklist_items', []),
        boards_comments: mk('boards_comments', []),
        boards_attachments: mk('boards_attachments', []),
    }
    return { useStore: (...names: string[]) => names.map(name => h.stores[name]) }
})

interface Deletable {
    delete: (key: string) => unknown
}

function revoke(membershipId: string) {
    const members = h.stores.boards_project_members as Deletable
    act(() => {
        members.delete(membershipId)
    })
}

afterEach(() => {
    cleanup()
    h.evicted.length = 0
})

describe('boards section layout', () => {
    it("drops a revoked board's cached rows while the section is open", async () => {
        const { default: BoardsLayout } = await import('../tinycld/boards/screens/_layout')
        render(<BoardsLayout />)
        // Let the membership query settle before the revocation.
        await new Promise(resolve => setTimeout(resolve, 20))

        revoke('m2')

        await waitFor(() =>
            expect(h.evicted).toEqual(
                expect.arrayContaining([
                    { collection: 'boards_projects', ids: ['p2'] },
                    { collection: 'boards_lists', ids: ['l2'] },
                    { collection: 'boards_cards', ids: ['c9'] },
                ])
            )
        )
        expect(h.evicted.flatMap(e => e.ids)).not.toContain('p1')
    })

    it('stops watching once the section unmounts', async () => {
        const { default: BoardsLayout } = await import('../tinycld/boards/screens/_layout')
        const view = render(<BoardsLayout />)
        await new Promise(resolve => setTimeout(resolve, 20))
        view.unmount()

        revoke('m1')
        await new Promise(resolve => setTimeout(resolve, 20))

        expect(h.evicted).toEqual([])
    })
})
