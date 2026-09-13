import type { Page, Request } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, closeCardPeek, createBoard, openBoard, openCard } from './helpers'

// How a board and a card reach the client, measured at the network: one
// request each. The board screen reads the project row through a view that
// fetches its back-relations (lists, cards, labels, epics, sprints, card
// reactions), so no board-scoped collection is listed on its own; a card
// opens the same way through its own children. The counts here are the
// contract collections.ts documents — a second request for `boards_cards`
// on a board open means an include stopped being served from the store.
//
// Read-only observation of requests the UI makes; nothing here writes
// through PocketBase directly.

const RECORDS = /\/api\/collections\/(boards_[a-z_]+)\/records(?:\/([^/?]+))?(\?.*)?$/

interface ListRequest {
    collection: string
    filter: string
    expand: string
}

/** Every list request to a boards collection since `start`, decoded. */
function observe(page: Page): { lists: ListRequest[]; stop: () => void } {
    const lists: ListRequest[] = []
    const onRequest = (request: Request) => {
        if (request.method() !== 'GET') return
        const match = request.url().match(RECORDS)
        // A record-by-id GET (`/records/<id>`) is not a list.
        if (!match || match[2]) return
        const params = new URL(request.url()).searchParams
        lists.push({
            collection: match[1] ?? '',
            filter: params.get('filter') ?? '',
            expand: params.get('expand') ?? '',
        })
    }
    page.on('request', onRequest)
    return { lists, stop: () => page.off('request', onRequest) }
}

const BOARD_COLLECTIONS = [
    'boards_lists',
    'boards_cards',
    'boards_labels',
    'boards_epics',
    'boards_sprints',
    'boards_card_reactions',
]

const CARD_COLLECTIONS = [
    'boards_checklist_items',
    'boards_comments',
    'boards_attachments',
    'boards_activity',
    'boards_card_watchers',
    'boards_comment_reactions',
    'boards_card_links',
    'boards_pr_links',
]

test.describe('Boards — one request per board, one per card', () => {
    test('opening a board lists the project once and no board-scoped collection', async ({
        page,
    }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        const first = `sync-a-${Date.now()}`
        const second = `sync-b-${Date.now()}`
        await createBoard(page, first)
        await addCard(page, 0, 'First card')
        await createBoard(page, second)
        await addCard(page, 0, 'Second card')

        // Switching to a board the client has already fetched once: its rows
        // were pruned when the screen left it, so this is a cold open.
        const observed = observe(page)
        await openBoard(page, first, 'First card')
        // Let the include demands settle before counting.
        await expect(page.getByText('First card')).toBeVisible()
        observed.stop()

        const projectLists = observed.lists.filter(r => r.collection === 'boards_projects')
        expect(projectLists.length).toBeGreaterThanOrEqual(1)
        for (const request of projectLists) {
            expect(request.expand).toContain('boards_cards_via_project')
        }
        const perCollection = observed.lists.filter(r => BOARD_COLLECTIONS.includes(r.collection))
        expect(
            perCollection,
            `board-scoped list requests: ${JSON.stringify(perCollection)}`
        ).toEqual([])
    })

    test('opening a card lists the card once and no child collection', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        const name = `sync-c-${Date.now()}`
        await createBoard(page, name)
        await addCard(page, 0, 'Fresh card')
        // Leave and come back so the card open is measured on a settled board.
        await createBoard(page, `${name}-other`)
        await addCard(page, 0, 'Other card')
        await openBoard(page, name, 'Fresh card')

        const observed = observe(page)
        await openCard(page, 'Fresh card')
        await expect(page.getByText('Activity', { exact: true })).toBeVisible()
        observed.stop()

        const cardLists = observed.lists.filter(r => r.collection === 'boards_cards')
        expect(cardLists.length).toBeGreaterThanOrEqual(1)
        for (const request of cardLists) {
            expect(request.expand).toContain('boards_comments_via_card')
        }
        const perChild = observed.lists.filter(r => CARD_COLLECTIONS.includes(r.collection))
        expect(perChild, `child list requests: ${JSON.stringify(perChild)}`).toEqual([])

        await closeCardPeek(page)
    })
})
