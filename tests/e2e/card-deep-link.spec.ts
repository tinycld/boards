import { expect, type Page, test, type WebSocket } from '@playwright/test'
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

// Switching boards from the sidebar replaces the board screen: the other
// board's URL carries no card, and the first board's peek does not follow.
// What Back does afterwards is pinned at the end.
test('switching boards from the sidebar lands on the other board without a card', async ({
    page,
}) => {
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
    await expect(page).toHaveURL(new RegExp(`/a/boards/${firstKey}/${firstKey}-1$`))

    await openBoardNamed(page, second)
    await expect(page).toHaveURL(new RegExp(`/a/boards/${secondKey}$`))
    await expect(cardSurface(page)).toHaveCount(0)

    // Pinned as observed, not as designed: the switch replaces the board
    // screen, and the browser's Back does not return to the first board's
    // peek or its bare board — it leaves the app for the blank page the tab
    // started on. The switch is a replace, so the history entries of the board
    // left are gone.
    await page.goBack()
    await expect(page).toHaveURL('about:blank')
})

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
