import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, closeCardPeek, createBoard } from './helpers'

// The cross-board list: what is mine shows up with its board and list, the
// search box narrows it, and a row opens the card without touching the
// board selection.
//
// Drives the UI only — no raw PB writes.

const MINE = 'Prepare the demo'
const OTHER = 'Someone else will do this'

let run = 0
async function freshBoard(page: Page): Promise<string> {
    const name = `mine-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

function peek(page: Page) {
    return page.getByTestId('cards-card-peek')
}

async function assignSelf(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
    await peek(page).getByRole('button', { name: 'Assign' }).click()
    await page.getByRole('menuitem').first().click()
    await expect(peek(page).getByRole('button', { name: 'Change assignees' })).toBeVisible()
    // The multi-select menu stays open after a pick; Escape closes it. If the
    // menu had already closed, that same Escape reaches the peek and closes
    // it instead — so the peek is closed explicitly only if it is still up.
    await page.keyboard.press('Escape')
    if ((await peek(page).count()) > 0) await closeCardPeek(page)
    await expect(peek(page)).toHaveCount(0)
}

async function openMyCards(page: Page) {
    await page.getByTestId('cards-sidebar-my-cards').click()
    await expect(page.getByTestId('cards-my-cards')).toBeVisible()
}

test.describe('Cards — My cards', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('lists assigned cards with their board and list, and searches', async ({ page }) => {
        const name = await freshBoard(page)
        await addCard(page, 0, MINE)
        await addCard(page, 0, OTHER)
        await assignSelf(page, MINE)

        await openMyCards(page)
        // Scoped by board name: earlier runs leave boards carrying the same
        // card title, and a row shows its board.
        const rows = page.locator('[data-testid^="cards-row-"]')
        await expect(rows.filter({ hasText: MINE }).filter({ hasText: name })).toHaveCount(1)
        await expect(rows.filter({ hasText: OTHER })).toHaveCount(0)
        const row = rows.filter({ hasText: MINE }).filter({ hasText: name })
        await expect(row).toContainText(name)
        await expect(row).toContainText('To do')

        // All cards shows the unassigned one too. Searched first: All lists
        // every card on every board in the database and the list is
        // virtualized, so an unsearched row may not be in the DOM at all.
        await page.getByTestId('cards-my-cards-mode-all').click()
        await page.getByTestId('cards-my-cards-search').fill('someone else')
        await expect(rows.filter({ hasText: OTHER }).filter({ hasText: name })).toHaveCount(1)
        await expect(rows.filter({ hasText: MINE })).toHaveCount(0)
    })

    test('a row opens the card page', async ({ page }) => {
        const name = await freshBoard(page)
        await addCard(page, 0, MINE)
        await assignSelf(page, MINE)

        await openMyCards(page)
        await page
            .locator('[data-testid^="cards-row-"]')
            .filter({ hasText: MINE })
            .filter({ hasText: name })
            .click()
        // The full-page card: its back button reads the board's name, and the
        // body renders the description section.
        await expect(page.getByRole('button', { name: 'Back to board' })).toContainText(name)
        await expect(page.getByText('Description', { exact: true })).toBeVisible()
    })
})
