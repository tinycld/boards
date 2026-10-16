import { expect, type Locator, type Page, test, type WebSocket } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import {
    addCard,
    addSubtask,
    boardCard,
    cardSurface,
    createBoard,
    openBoard,
    openBoardNamed,
    openCard,
    pageUrl,
    peekUrl,
    uniqueNumber,
    uniqueStamp,
} from './helpers'

// A pasted card link opened cold: the card's peek opens and the address bar
// keeps the card. Three spellings are covered — the canonical
// /a/boards/KEY/KEY-1, the old /a/boards/KEY-1, and /a/boards?focused=KEY-1,
// which core's notifications mint for every package and which every stored
// notification link carries. The last two are redirected to the first, which
// is the one write the recording allows.
//
// The `page.goto` here is the subject, not a shortcut: this is a cold load of
// a URL, which is exactly the thing in-app navigation can't exercise. Every
// URL the app writes during that load is recorded too, because the bug was a
// chain of replaces that ended on the bare board with the card gone — the
// final URL alone would not catch a version that rewrote the board URL
// without its card and then happened to recover.
//
// What the recording is checked for is precisely that: the BOARD's URL is
// never written without the card. A production web build may still write the
// bare app root once while the workspace layout's async-route chunk is in
// flight — Expo Router derives the URL from the navigators that are mounted,
// and that write is corrected the moment the layout mounts — so the bare root
// is not what this guards against.

declare global {
    interface Window {
        __urlWrites: { method: 'pushState' | 'replaceState'; url: string }[]
    }
}

async function recordUrlWrites(page: Page) {
    await page.addInitScript(() => {
        window.__urlWrites = []
        const record = (method: 'pushState' | 'replaceState') => {
            const write = history[method]
            return function recorded(
                this: History,
                data: unknown,
                unused: string,
                url?: string | URL | null
            ) {
                if (url != null) window.__urlWrites.push({ method, url: String(url) })
                return write.call(this, data, unused, url)
            }
        }
        history.replaceState = record('replaceState')
        history.pushState = record('pushState')
    })
}

for (const spelling of ['canonical', 'old', 'focused'] as const) {
    test(`a card link (${spelling}) opens the card and keeps its URL on a cold load`, async ({
        page,
    }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        const key = `LINK${uniqueNumber() % 100000}`
        await createBoard(page, `deep-link-${uniqueStamp()}`, key)
        await addCard(page, 0, 'Linked card')

        const canonical = `/a/boards/${key}/${key}-1`
        const links = {
            canonical,
            old: `/a/boards/${key}-1`,
            focused: `/a/boards?focused=${key}-1`,
        }
        const link = links[spelling]
        const before = page.url()
        await recordUrlWrites(page)
        await page.goto(link)

        const peek = page.getByTestId('boards-card-peek')
        await expect(peek).toBeVisible()
        await expect(peek.getByTestId('boards-detail-key')).toHaveText(`${key}-1`)
        expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(canonical)

        const writes = await page.evaluate(() => window.__urlWrites)
        const boardWrites = writes.filter(write => write.url.startsWith('/a/boards'))
        // The board's URL was never written without its card.
        expect(boardWrites.filter(write => !write.url.includes(`${key}-1`))).toEqual([])
        // A cold load adds no history entry of its own beyond the goto's, so
        // one Back returns to the page the goto left.
        expect(writes.filter(write => write.method === 'pushState')).toEqual([])
        await page.goBack()
        await expect(page).toHaveURL(before)
    })
}

// Opening a card from a row on the full page is a navigation: the next card's
// page stacks on this one rather than dropping back to the board's peek, so
// the browser's Back returns to the page it was opened from. `page.goBack()`
// is the browser's own Back, not an in-app `goto`.
test('Back from a sub-task’s page returns to its parent’s page', async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'boards')
    const key = `PAGE${uniqueNumber() % 100000}`
    await createBoard(page, `back-page-${uniqueStamp()}`, key)
    await addCard(page, 0, 'Parent')
    await addSubtask(page, 'Parent', 'Child')

    await openCard(page, 'Parent')
    await page.getByLabel('Open full page').click()
    // The page a card was opened from stays mounted under the next one.
    const cardPage = page.getByTestId('boards-card-page').filter({ visible: true })
    await expect(cardPage.getByText('Description', { exact: true })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/1$`))

    await cardPage.getByTestId('boards-subtask-row').getByText('Child').click()
    await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/2$`))
    await expect(cardPage.getByTestId('boards-detail-key')).toHaveText(`${key}-2`)

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/1$`))
    await expect(cardPage.getByTestId('boards-detail-key')).toHaveText(`${key}-1`)
})

// j and k on the full page push the next card's page, so the browser's Back
// steps back through the cards they walked.
test('j on the full page pushes, so Back returns to the card it left', async ({ page }) => {
    const key = await boardWithThreeCards(page, 'page-step')
    await openFullPage(page, 'Alpha')
    await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/1$`))

    await page.keyboard.press('j')
    await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/2$`))
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/1$`))
    await expect(visibleCardPage(page).getByTestId('boards-detail-key')).toHaveText(`${key}-1`)
})

// Escape and "Back to board" leave for the board in one step, whatever the
// reader walked: they name the board, not the previous card.
test('Escape on an expanded page leaves for the board in one step', async ({ page }) => {
    const key = await boardWithThreeCards(page, 'page-escape')
    await openFullPage(page, 'Alpha')
    await expect(page).toHaveURL(pageUrl(key, 1))
    await page.keyboard.press('Escape')

    await expectBareBoard(page, key)
})

test('Escape leaves in one step, from the peek and from the page', async ({ page }) => {
    const key = await boardWithThreeCards(page, 'escape-steps')
    await openCard(page, 'Alpha')
    await page.keyboard.press('j')
    await expect(page).toHaveURL(peekUrl(key, 2))
    await page.keyboard.press('j')
    await expect(page).toHaveURL(peekUrl(key, 3))
    await page.keyboard.press('Escape')
    await expectBareBoard(page, key)

    await openFullPage(page, 'Alpha')
    await page.keyboard.press('j')
    await expect(page).toHaveURL(pageUrl(key, 2))
    await page.keyboard.press('j')
    await expect(page).toHaveURL(pageUrl(key, 3))
    await page.keyboard.press('Escape')
    await expectBareBoard(page, key)
})

// Each stacked page owns its keys. The page j pushed shared its shortcut ids
// with the page under it, and unmounting on Back deleted them, so the page
// Back returned to answered no key at all.
test('j, goBack, Escape lands on the bare board', async ({ page }) => {
    const key = await boardWithThreeCards(page, 'page-keys')
    await openFullPage(page, 'Alpha')

    await page.keyboard.press('j')
    await expect(page).toHaveURL(pageUrl(key, 2))
    await page.goBack()
    await expect(page).toHaveURL(pageUrl(key, 1))
    await expect(visibleCardPage(page).getByTestId('boards-detail-key')).toHaveText(`${key}-1`)
    await page.keyboard.press('Escape')

    await expectBareBoard(page, key)
})

// The same for peeks: the peek Back returns to answers its keys, though the
// peek it uncovered shared nothing with it but the surface.
test('j, goBack, j on the peek steps on from the card Back returned to', async ({ page }) => {
    const key = await boardWithThreeCards(page, 'peek-keys')
    await openCard(page, 'Alpha')

    await page.keyboard.press('j')
    await expect(page).toHaveURL(peekUrl(key, 2))
    await page.goBack()
    await expect(page).toHaveURL(peekUrl(key, 1))
    await expect(cardSurface(page).getByTestId('boards-detail-key')).toHaveText(`${key}-1`)
    await page.keyboard.press('j')
    await expect(page).toHaveURL(peekUrl(key, 2))
    await page.keyboard.press('Escape')

    await expectBareBoard(page, key)
})

// Each peek is a navigation, so the browser's Back walks the cards in the
// order they were opened and ends on the board.
test('Back walks peeks, then the board', async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'boards')
    const key = `WALK${uniqueNumber() % 100000}`
    await createBoard(page, `back-walk-${uniqueStamp()}`, key)
    await addCard(page, 0, 'Parent')
    await addSubtask(page, 'Parent', 'Child')

    await openCard(page, 'Parent')
    await expect(page).toHaveURL(peekUrl(key, 1))
    await cardSurface(page).getByTestId('boards-subtask-row').getByText('Child').click()
    await expect(page).toHaveURL(peekUrl(key, 2))
    await expect(cardSurface(page).getByTestId('boards-detail-key')).toHaveText(`${key}-2`)

    await page.goBack()
    await expect(page).toHaveURL(peekUrl(key, 1))
    await expect(cardSurface(page).getByTestId('boards-detail-key')).toHaveText(`${key}-1`)

    await page.goBack()
    await expectBareBoard(page, key)
})

// Pressing the card that is already open is not a navigation. Expo Router has
// no same-URL short-circuit, so a push would stack a second child for the same
// card: the peek would remount (the composer, opened only by a tap, folds
// back) and Back would seem to do nothing.
test('pressing the open card again keeps its peek and adds no history', async ({ page }) => {
    const key = await boardWithThreeCards(page, 'reopen')
    await openCard(page, 'Alpha')
    await expect(page).toHaveURL(peekUrl(key, 1))
    const composer = cardSurface(page).getByTestId('boards-comment-composer')
    await composer.getByRole('button', { name: 'Write a comment' }).click()
    const editor = composer.locator('.ProseMirror')
    await expect(editor).toBeFocused()
    await editor.pressSequentially('Draft survives')
    await expect(editor).toContainText('Draft survives')

    await boardCard(page, 'Alpha').click()
    await expect(page).toHaveURL(peekUrl(key, 1))
    await expect(editor).toContainText('Draft survives')

    await page.goBack()
    await expectBareBoard(page, key)
})

test('expand, then Back returns to the peek', async ({ page }) => {
    const key = await boardWithThreeCards(page, 'expand-back')
    await openFullPage(page, 'Alpha')
    await expect(page).toHaveURL(pageUrl(key, 1))

    await page.goBack()
    await expect(page).toHaveURL(peekUrl(key, 1))
    await expect(visibleCardPage(page)).toHaveCount(0)
    await expect(cardSurface(page).getByTestId('boards-detail-key')).toHaveText(`${key}-1`)
})

// j and k push the neighbour on the peek and on the page, so Back steps back
// through the cards walked.
test('j pushes on the peek and on the page', async ({ page }) => {
    const key = await boardWithThreeCards(page, 'jk-push')
    await openCard(page, 'Alpha')
    await page.keyboard.press('j')
    await expect(page).toHaveURL(peekUrl(key, 2))
    await page.keyboard.press('j')
    await expect(page).toHaveURL(peekUrl(key, 3))
    await page.goBack()
    await expect(page).toHaveURL(peekUrl(key, 2))

    await page.getByLabel('Open full page').click()
    await expect(page).toHaveURL(pageUrl(key, 2))
    await page.keyboard.press('j')
    await expect(page).toHaveURL(pageUrl(key, 3))
    await page.goBack()
    await expect(page).toHaveURL(pageUrl(key, 2))
})

// A cold load of a page URL has no history to pop, but the board is still
// rendered beneath it, so Escape has somewhere to land.
test('a deep-linked page has the board beneath', async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'boards')
    const key = `DEEP${uniqueNumber() % 100000}`
    await createBoard(page, `deep-page-${uniqueStamp()}`, key)
    await addCard(page, 0, 'Alpha')

    // An initial-load deep link is the subject, not in-app navigation.
    await page.goto(`/a/boards/${key}/1`)
    await expect(visibleCardPage(page).getByText('Description', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')

    await expectBareBoard(page, key)
    await expect(boardCard(page, 'Alpha')).toBeVisible()
})

// One room per board, however many card views are stacked on it: the peek, the
// page expanded from it and the pages j pushes are children of the board's
// layout, which owns the socket. `page.on('websocket')` sees every socket the
// tab opens; a board whose cards opened their own would show two or more live.
test('peek, page and j share the board’s one realtime socket', async ({ page }) => {
    const live = new Set<WebSocket>()
    let opened = 0
    page.on('websocket', socket => {
        if (!socket.url().includes('/api/realtime/boards/')) return
        opened += 1
        live.add(socket)
        socket.on('close', () => live.delete(socket))
    })
    const key = await boardWithThreeCards(page, 'one-socket')
    await expect.poll(() => live.size).toBe(1)
    const openedForBoard = opened

    await openCard(page, 'Alpha')
    expect(live.size).toBe(1)

    await page.getByLabel('Open full page').click()
    await expect(visibleCardPage(page).getByText('Description', { exact: true })).toBeVisible()
    expect(live.size).toBe(1)

    await page.keyboard.press('j')
    await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/2$`))
    await expect(visibleCardPage(page).getByTestId('boards-detail-key')).toHaveText(`${key}-2`)
    await page.keyboard.press('j')
    await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/3$`))
    await expect(visibleCardPage(page).getByTestId('boards-detail-key')).toHaveText(`${key}-3`)

    expect(live.size).toBe(1)
    expect(opened).toBe(openedForBoard)
})

// Only OPEN sockets to the boards room are counted: a covered board parks and
// closes its socket, so a count of sockets ever opened would grow with every
// board visited.
function openBoardSockets(page: Page): Set<WebSocket> {
    const live = new Set<WebSocket>()
    page.on('websocket', socket => {
        if (!socket.url().includes('/api/realtime/boards/')) return
        live.add(socket)
        socket.on('close', () => live.delete(socket))
    })
    return live
}

// A `?focused=` link followed from an open board — here through search, the
// way core's notifications reach it too — lands on the other board with the
// card, pushed over the board it was followed from. The bare `/a/boards` the
// link names replaces itself with the board, so Back skips it and returns to
// the board and card the reader was on. Only the board on screen holds a room.
test('a search hit on another board lands on it, and Back returns to the card', async ({
    page,
}) => {
    const live = openBoardSockets(page)
    await login(page)
    await navigateToPackage(page, 'boards')
    const target = `Focus target ${uniqueStamp()}`
    const farKey = `FOCB${uniqueNumber() % 100000}`
    await createBoard(page, `focus-far-${uniqueStamp()}`, farKey)
    await addCard(page, 0, target)
    const homeKey = `FOCA${uniqueNumber() % 100000}`
    const home = `focus-home-${uniqueStamp()}`
    await createBoard(page, home, homeKey)
    await addCard(page, 0, 'Alpha')
    await openCard(page, 'Alpha')
    await expect(page).toHaveURL(peekUrl(homeKey, 1))
    await expect.poll(() => live.size).toBe(1)

    await page.keyboard.press('/')
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible()
    await page.keyboard.type(target)
    await page.getByRole('option').filter({ hasText: target }).click()

    await expect(page).toHaveURL(peekUrl(farKey, 1))
    await expect(cardSurface(page).getByTestId('boards-detail-key')).toHaveText(`${farKey}-1`)
    await expect(boardCard(page, target)).toBeVisible()
    await expect(page.getByText('This card doesn’t exist or was removed')).toHaveCount(0)
    await expect(page.getByTestId('boards-board-room')).toHaveCount(1)
    await expect.poll(() => live.size).toBe(1)

    await page.goBack()
    await expect(page).toHaveURL(peekUrl(homeKey, 1))
    await expect(cardSurface(page).getByTestId('boards-detail-key')).toHaveText(`${homeKey}-1`)
    await expect(boardCard(page, 'Alpha')).toBeVisible()
    await expect(page.getByText('This card doesn’t exist or was removed')).toHaveCount(0)
    await expect(page.getByTestId('boards-board-room')).toHaveCount(1)
    await expect.poll(() => live.size).toBe(1)
})

// Switching boards from the sidebar pushes the other board: its URL carries no
// card, and the first board's peek does not follow. The first board stays
// beneath, parked — its room left, its socket closed — so Back returns to it
// with its card open, and it joins its room again.
test('switching boards from the sidebar, then Back, returns to the card on the first board', async ({
    page,
}) => {
    const live = openBoardSockets(page)
    await login(page)
    await navigateToPackage(page, 'boards')
    const first = `swap-a-${uniqueStamp()}`
    const second = `swap-b-${uniqueStamp()}`
    const firstKey = `SWAPA${uniqueNumber() % 100000}`
    const secondKey = `SWAPB${uniqueNumber() % 100000}`
    await createBoard(page, first, firstKey)
    await addCard(page, 0, 'Alpha')
    await createBoard(page, second, secondKey)
    await openBoard(page, first, 'Alpha')
    await openCard(page, 'Alpha')
    await expect(page).toHaveURL(peekUrl(firstKey, 1))
    await expect.poll(() => live.size).toBe(1)

    await openBoardNamed(page, second)
    await expect(page).toHaveURL(new RegExp(`/a/boards/${secondKey}$`))
    await expect(cardSurface(page)).toHaveCount(0)
    // The first board's card does not carry over under the second board.
    await expect(page.getByText('This card doesn’t exist or was removed')).toHaveCount(0)
    await expect.poll(() => live.size).toBe(1)

    await page.goBack()
    await expect(page).toHaveURL(peekUrl(firstKey, 1))
    await expect(cardSurface(page).getByTestId('boards-detail-key')).toHaveText(`${firstKey}-1`)
    await expect(boardCard(page, 'Alpha')).toBeVisible()
    await expect(page.getByTestId('boards-board-room')).toHaveCount(1)
    await expect.poll(() => live.size).toBe(1)
})

// Leaving Boards for another package and coming back is not a board switch:
// the board is not covered by another board, so it does not park. The page
// open on it, the comment half-written there and the board's socket are all
// as they were. A full page rather than a peek: a rail press is outside the
// peek and closes it first, which is the peek's own rule.
test('leaving Boards and coming back keeps the open card, its draft and its socket', async ({
    page,
}) => {
    let opened = 0
    let closed = 0
    page.on('websocket', socket => {
        if (!socket.url().includes('/api/realtime/boards/')) return
        opened += 1
        socket.on('close', () => {
            closed += 1
        })
    })
    const key = await boardWithThreeCards(page, 'leave-return')
    await openFullPage(page, 'Alpha')
    await expect(page).toHaveURL(pageUrl(key, 1))
    await expect.poll(() => opened - closed).toBe(1)
    // The board the bare /a/boards first landed on parked when this one was
    // created, so sockets already closed are not this trip's.
    const openedBefore = opened
    const closedBefore = closed
    const composer = visibleCardPage(page).getByTestId('boards-comment-composer')
    await composer.getByRole('button', { name: 'Write a comment' }).click()
    const editor = composer.locator('.ProseMirror')
    await expect(editor).toBeFocused()
    await editor.pressSequentially('Draft survives a trip')
    await expect(editor).toContainText('Draft survives a trip')

    await navigateToPackage(page, 'settings')
    await navigateToPackage(page, 'boards')

    await expect(page).toHaveURL(pageUrl(key, 1))
    await expect(visibleCardPage(page).getByTestId('boards-detail-key')).toHaveText(`${key}-1`)
    await expect(editor).toContainText('Draft survives a trip')
    expect(opened).toBe(openedBefore)
    expect(closed).toBe(closedBefore)
})

// The board on screen picked again from the sidebar is not a new step: a push
// would stack a second copy of it, and Back would seem to do nothing.
test('picking the board on screen in the sidebar adds no history', async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'boards')
    const firstKey = `SAMEA${uniqueNumber() % 100000}`
    const secondKey = `SAMEB${uniqueNumber() % 100000}`
    const second = `same-b-${uniqueStamp()}`
    await createBoard(page, `same-a-${uniqueStamp()}`, firstKey)
    await createBoard(page, second, secondKey)
    await expect(page).toHaveURL(new RegExp(`/a/boards/${secondKey}$`))

    await openBoardNamed(page, second)
    await expect(page).toHaveURL(new RegExp(`/a/boards/${secondKey}$`))

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/a/boards/${firstKey}$`))
})

// A page link whose board does not exist says so. The card child cannot
// resolve anything without its board, and a page draws an opaque screen, so
// the board's not-found has to show over the card children, not under them.
test('a page link on a missing board says the board is missing', async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'boards')
    // An initial-load deep link is the subject, not in-app navigation.
    await page.goto(`/a/boards/GONE${uniqueNumber() % 100000}/12`)
    const notFound = page.getByText('This board doesn’t exist or you don’t have access to it')
    await expect(notFound).toBeVisible()
    // Visible is not enough: an opaque page laid over it still counts as
    // visible. The press point has to land on the message itself.
    await expect.poll(() => isOnTop(notFound)).toBe(true)
})

/**
 * Whether `target` is painted on top at its centre.
 *
 * Hit-testing skips `pointer-events: none`, and the board's card children sit
 * in a layer with exactly that on web, so an opaque page laid over the message
 * would not be hit and the message would read as on top. Every element is made
 * hit-testable for the one probe, so the hit is what is drawn there.
 */
function isOnTop(target: Locator): Promise<boolean> {
    return target.evaluate(element => {
        const probe = document.createElement('style')
        probe.textContent = '* { pointer-events: auto !important; }'
        document.head.append(probe)
        const box = element.getBoundingClientRect()
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        probe.remove()
        return hit !== null && element.contains(hit)
    })
}

async function expectBareBoard(page: Page, key: string) {
    await expect(page).toHaveURL(new RegExp(`/a/boards/${key}$`))
    await expect(visibleCardPage(page)).toHaveCount(0)
    await expect(cardSurface(page)).toHaveCount(0)
}

async function boardWithThreeCards(page: Page, name: string): Promise<string> {
    await login(page)
    await navigateToPackage(page, 'boards')
    const key = `STEP${uniqueNumber() % 100000}`
    await createBoard(page, `${name}-${uniqueStamp()}`, key)
    await addCard(page, 0, 'Alpha')
    await addCard(page, 0, 'Beta')
    await addCard(page, 0, 'Gamma')
    return key
}

async function openFullPage(page: Page, title: string) {
    await openCard(page, title)
    await page.getByLabel('Open full page').click()
    await expect(visibleCardPage(page).getByText('Description', { exact: true })).toBeVisible()
}

/** The card page on top: a page a card was opened from stays mounted under it. */
function visibleCardPage(page: Page) {
    return page.getByTestId('boards-card-page').filter({ visible: true })
}
