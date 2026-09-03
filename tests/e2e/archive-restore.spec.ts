import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, cardsInColumn, createBoard } from './helpers'

// The way back from archive, for cards and for boards, and the one
// destructive board action. Before this panel existed the only restore path
// was the command line; a spec that only archived would have kept passing
// while the UI offered no return.
//
// Drives the UI only — no raw PB writes.

const CARD_TITLE = 'Retire the old banner'

let run = 0
async function freshBoard(page: Page): Promise<string> {
    const name = `archive-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

function peek(page: Page) {
    return page.getByTestId('cards-card-peek')
}

async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
}

async function openBoardMenu(page: Page) {
    await page.getByRole('button', { name: 'Board actions' }).click()
}

test.describe('Cards — archive and restore', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('an archived card is listed in the panel and restored to its column', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await peek(page).getByRole('button', { name: 'More actions' }).click()
        await page.getByText('Archive card', { exact: true }).click()
        await expect(boardCard(page, CARD_TITLE)).toHaveCount(0)

        await page.getByTestId('cards-archived-button').click()
        const panel = page.getByTestId('cards-archived-panel')
        await expect(panel).toBeVisible()
        const row = panel.locator('[data-testid^="cards-archived-row-"]').first()
        await expect(row).toContainText(CARD_TITLE)
        await expect(row).toContainText('To do')

        await row.getByRole('button', { name: `Restore ${CARD_TITLE}` }).click()
        await expect(panel.locator('[data-testid^="cards-archived-row-"]')).toHaveCount(0)
        await panel.getByRole('button', { name: 'Close' }).click()
        expect(await cardsInColumn(page, 'To do')).toContain(CARD_TITLE)
    })

    test('an archived card can be deleted for good from the panel', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await peek(page).getByRole('button', { name: 'More actions' }).click()
        await page.getByText('Archive card', { exact: true }).click()

        await page.getByTestId('cards-archived-button').click()
        const panel = page.getByTestId('cards-archived-panel')
        await panel.getByRole('button', { name: `Delete ${CARD_TITLE}` }).click()
        await page.getByRole('button', { name: 'Delete', exact: true }).click()
        await expect(panel.locator('[data-testid^="cards-archived-row-"]')).toHaveCount(0)
        await expect(panel).toContainText('Nothing here')
    })

    test('an archived board moves to the sidebar Archived section and can be restored', async ({
        page,
    }) => {
        const name = await freshBoard(page)
        await openBoardMenu(page)
        await page.getByText('Archive board', { exact: true }).click()
        await page.getByRole('button', { name: 'Archive', exact: true }).click()

        const archivedToggle = page.getByTestId('cards-archived-boards')
        await expect(archivedToggle).toBeVisible()
        await archivedToggle.click()
        await page.getByText(name, { exact: true }).click()

        const banner = page.getByTestId('cards-archived-banner')
        await expect(banner).toBeVisible()
        await banner.getByRole('button', { name: 'Restore board' }).click()
        await expect(banner).toHaveCount(0)
        await expect(page.getByTestId('cards-archived-boards')).toHaveCount(0)
    })

    test('deleting a board requires its name and removes it from the sidebar', async ({ page }) => {
        const name = await freshBoard(page)
        await addCard(page, 0, CARD_TITLE)
        await openBoardMenu(page)
        await page.getByText('Delete board…', { exact: true }).click()

        const dialog = page.getByTestId('cards-delete-board-dialog')
        await expect(dialog).toContainText('3 lists, 1 card')
        const confirm = dialog.getByRole('button', { name: 'Delete board' })
        await expect(confirm).toBeDisabled()
        await dialog.getByLabel('Board name').fill('not the name')
        await expect(confirm).toBeDisabled()
        await dialog.getByLabel('Board name').fill(name)
        await confirm.click()

        await expect(dialog).toHaveCount(0)
        await expect(page.getByText(name, { exact: true })).toHaveCount(0)
    })
})
