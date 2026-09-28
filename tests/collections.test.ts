import type { CoreStores } from '@tinycld/core/lib/pocketbase'
import { describe, expect, it, vi } from 'vitest'
import { registerCollections } from '../tinycld/boards/collections'

// The 0.10 contract for every boards collection: sync only what a live query
// asks for, and let realtime follow that same filter rather than the whole
// table. A collection added later without both options silently reverts to
// eager-with-full-table-realtime, so this pins the option pair AND the set of
// registered names — an addition that forgets the options fails here instead
// of shipping.
const EXPECTED_COLLECTION_NAMES = [
    'boards_checklist_items',
    'boards_comments',
    'boards_attachments',
    'boards_activity',
    'boards_card_watchers',
    'boards_comment_reactions',
    'boards_card_links',
    'boards_pr_links',
    'boards_sprint_snapshots',
    'boards_card_reactions',
    'boards_lists',
    'boards_labels',
    'boards_epics',
    'boards_sprints',
    'boards_cards',
    'boards_projects',
    'boards_project_members',
    'boards_project_repos',
    'boards_share_links',
]

describe('boards collections', () => {
    it('registers every collection on demand with per-query realtime', () => {
        // registerCollections only reads coreStores as relation targets
        // (`user: coreStores.users`, `group: coreStores.groups`) — it never
        // calls anything on it, so a bare cast stands in for the real store.
        const fakeCoreStores = {} as CoreStores

        const registeredNames: string[] = []
        const spyNewCollection = vi.fn((name: string, options?: Record<string, unknown>) => {
            registeredNames.push(name)
            return { name, options }
        })

        registerCollections(
            spyNewCollection as unknown as Parameters<typeof registerCollections>[0],
            fakeCoreStores
        )

        expect(registeredNames.sort()).toEqual([...EXPECTED_COLLECTION_NAMES].sort())

        for (const call of spyNewCollection.mock.calls) {
            const [name, options] = call
            expect(options, `${name} is missing its options`).toBeDefined()
            expect(options, `${name} must sync on demand`).toMatchObject({
                syncMode: 'on-demand',
                realtime: 'query',
            })
        }
    })
})
