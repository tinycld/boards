import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import {
    addCard,
    boardCard,
    CARD_CREATE,
    cardSurface,
    closeCardPeek,
    createBoard,
    holdRequests,
    openCard,
} from './helpers'

// A card the server has not answered for yet.
//
// Creating a card is optimistic: it is on the board at once and can be opened,
// and the composer takes the next title. The server gives the card its number
// (the 12 of PL-12) only when it answers. Each test here holds the create
// request so it can act in that window on purpose. The window is a few
// milliseconds on a laptop but up to a second on a loaded CI runner, so a bug
// here otherwise shows only in CI.

let run = 0

async function freshBoard(page: Parameters<typeof createBoard>[0]): Promise<string> {
    const key = `SAVE${(Date.now() % 10000) + run}`
    await createBoard(page, `before-save-${Date.now()}-${run++}`, key)
    return key
}

test.describe('a card the server has not saved yet', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
    })

    test('the composer takes the next title while the last one saves', async ({ page }) => {
        const key = await freshBoard(page)
        const release = await holdRequests(page, 'POST', CARD_CREATE)

        const input = page.getByPlaceholder('What needs doing?')
        await page.getByText('Add card', { exact: true }).first().click()
        await expect(input).toBeFocused()
        await page.keyboard.type('first title')
        await page.keyboard.press('Enter')
        await expect(boardCard(page, 'first title')).toBeVisible()

        // Typed, not filled: a field that is read-only while the first card
        // saves drops these keystrokes, and that is what a user sees.
        await page.keyboard.type('second title')
        await page.keyboard.press('Enter')
        await expect(boardCard(page, 'second title')).toBeVisible()

        release()
        await expect(boardCard(page, 'first title').getByTestId('boards-card-key')).toHaveText(
            new RegExp(`^${key}-[12]$`)
        )
        await expect(boardCard(page, 'second title').getByTestId('boards-card-key')).toHaveText(
            new RegExp(`^${key}-[12]$`)
        )
        await page.keyboard.press('Escape')
    })

    test('an open card takes its key into the URL, and its page, once numbered', async ({
        page,
    }) => {
        const key = await freshBoard(page)
        const release = await holdRequests(page, 'POST', CARD_CREATE)
        await addCard(page, 0, 'opened early')
        await openCard(page, 'opened early')
        await expect(page).toHaveURL(/\?focused=[a-z0-9]{15}$/)

        release()
        await expect(cardSurface(page).getByTestId('boards-detail-key')).toHaveText(`${key}-1`)
        await expect(page).toHaveURL(new RegExp(`/a/boards/${key}-1$`))

        await cardSurface(page).getByLabel('Open full page').click()
        await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/1$`))

        // Back returns to the key spelling: the id spelling was replaced, not
        // left in the history under it.
        await page.goBack()
        await expect(page).toHaveURL(new RegExp(`/a/boards/${key}-1$`))
        await closeCardPeek(page)
    })

    test('a card still saving opens on its own page, which takes the number once it lands', async ({
        page,
    }) => {
        const key = await freshBoard(page)
        const release = await holdRequests(page, 'POST', CARD_CREATE)
        await addCard(page, 0, 'paged early')
        await openCard(page, 'paged early')

        await cardSurface(page).getByLabel('Open full page').click()
        await expect(page.getByRole('button', { name: 'Back to board' })).toBeVisible()
        await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/[a-z0-9]{15}$`))

        release()
        await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/1$`))
        // Still the page, not a remount into "this card doesn't exist".
        await expect(page.getByRole('button', { name: 'Back to board' })).toBeVisible()
    })
})
