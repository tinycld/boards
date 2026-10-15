import { expect, type Page, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import {
    addCard,
    addSubtask,
    cardSurface,
    createBoard,
    openCard,
    uniqueNumber,
    uniqueStamp,
} from './helpers'

// A pasted card link opened cold: the card's peek opens and the address bar
// keeps the card. Two spellings are covered — the canonical /a/boards/KEY-1,
// and /a/boards?focused=KEY-1, which core's notifications mint for every
// package and which every stored notification link carries. The second is
// redirected to the first, which is the one write the recording allows.
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
        __urlWrites: string[]
    }
}

async function recordUrlWrites(page: Page) {
    await page.addInitScript(() => {
        window.__urlWrites = []
        const record = (write: History['replaceState']) =>
            function recorded(
                this: History,
                data: unknown,
                unused: string,
                url?: string | URL | null
            ) {
                if (url != null) window.__urlWrites.push(String(url))
                return write.call(this, data, unused, url)
            }
        history.replaceState = record(history.replaceState)
        history.pushState = record(history.pushState)
    })
}

for (const spelling of ['path', 'focused'] as const) {
    test(`a card link (${spelling}) opens the card and keeps its URL on a cold load`, async ({
        page,
    }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        const key = `LINK${uniqueNumber() % 100000}`
        await createBoard(page, `deep-link-${uniqueStamp()}`, key)
        await addCard(page, 0, 'Linked card')

        const canonical = `/a/boards/${key}-1`
        const link = spelling === 'path' ? canonical : `/a/boards?focused=${key}-1`
        await recordUrlWrites(page)
        await page.goto(link)

        const peek = page.getByTestId('boards-card-peek')
        await expect(peek).toBeVisible()
        await expect(peek.getByTestId('boards-detail-key')).toHaveText(`${key}-1`)
        expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(canonical)

        // The board's URL was never written without its card.
        const writes = await page.evaluate(() => window.__urlWrites)
        expect(
            writes.filter(url => url.startsWith('/a/boards') && url !== link && url !== canonical)
        ).toEqual([])
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

// Escape on a page expanded from the peek returns to that peek, as it did
// before the card pages stacked.
test('Escape on an expanded page returns to the card’s peek', async ({ page }) => {
    const key = await boardWithThreeCards(page, 'page-escape')
    await openFullPage(page, 'Alpha')
    await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/1$`))
    await page.keyboard.press('Escape')

    await expect(page).toHaveURL(new RegExp(`/a/boards/${key}-1$`))
    await expect(visibleCardPage(page)).toHaveCount(0)
    await expect(cardSurface(page).getByTestId('boards-detail-key')).toHaveText(`${key}-1`)
})

// However many cards j walked, Escape and "Back to board" leave for the board
// in one step, with the card the reader was on peeked: they name the board,
// not the previous card.
test('j, j, Escape lands on the board with the last card peeked', async ({ page }) => {
    const key = await boardWithThreeCards(page, 'page-leave')
    await openFullPage(page, 'Alpha')

    await page.keyboard.press('j')
    await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/2$`))
    await page.keyboard.press('j')
    await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/3$`))
    await page.keyboard.press('Escape')

    await expect(page).toHaveURL(new RegExp(`/a/boards/${key}-3$`))
    await expect(visibleCardPage(page)).toHaveCount(0)
    await expect(cardSurface(page).getByTestId('boards-detail-key')).toHaveText(`${key}-3`)
})

// Each stacked page owns its keys. The page j pushed shared its shortcut ids
// with the page under it, and unmounting on Back deleted them, so the page
// Back returned to answered no key at all.
test('j, goBack, Escape lands on the board with the card peeked', async ({ page }) => {
    const key = await boardWithThreeCards(page, 'page-keys')
    await openFullPage(page, 'Alpha')

    await page.keyboard.press('j')
    await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/2$`))
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/1$`))
    await expect(visibleCardPage(page).getByTestId('boards-detail-key')).toHaveText(`${key}-1`)
    await page.keyboard.press('Escape')

    await expect(page).toHaveURL(new RegExp(`/a/boards/${key}-1$`))
    await expect(visibleCardPage(page)).toHaveCount(0)
    await expect(cardSurface(page).getByTestId('boards-detail-key')).toHaveText(`${key}-1`)
})

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
