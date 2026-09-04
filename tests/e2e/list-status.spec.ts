import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, columnHeader, createBoard } from './helpers'

// List status end to end: the column menu sets it, the header and the card
// faces read it back, the filter's status facet narrows by it, and the board
// settings dialog round-trips the auto-archive days. The sweep itself is
// time-based and covered in Go.
//
// Drives the UI only — no raw PB writes.

const ALPHA = 'Alpha task'
const BRAVO = 'Bravo task'

let run = 0
async function freshBoard(page: Page): Promise<string> {
    const name = `status-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

async function setListStatus(page: Page, listName: string, category: string) {
    await page.getByRole('button', { name: `${listName} list actions` }).click()
    await page.getByText(/^Status: /).click()
    await page.getByTestId(`cards-list-status-${category}`).click()
}

async function openFilter(page: Page) {
    await page.getByTestId('cards-filter-button').click()
    await expect(page.getByTestId('cards-filter-panel')).toBeVisible()
}

async function closeFilter(page: Page) {
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('cards-filter-panel')).toHaveCount(0)
}

function glyph(page: Page, listName: string, category: string) {
    return columnHeader(page, listName).getByTestId(`cards-list-category-${category}`)
}

test.describe('Cards — list status', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('a new board carries the default statuses, and the menu changes one', async ({ page }) => {
        await freshBoard(page)
        await expect(glyph(page, 'To do', 'todo')).toBeVisible()
        await expect(glyph(page, 'Doing', 'in_progress')).toBeVisible()
        await expect(glyph(page, 'Done', 'done')).toBeVisible()

        // A card in the Done list wears the closed face; canceling the list
        // keeps it closed but changes the glyph.
        await addCard(page, 2, ALPHA)
        const face = boardCard(page, ALPHA)
        await expect(face.locator('[data-testid^="board-card-closed-"]')).toBeVisible()

        await setListStatus(page, 'Done', 'canceled')
        await expect(glyph(page, 'Done', 'canceled')).toBeVisible()
        await expect(face.locator('[data-testid^="board-card-closed-"]')).toBeVisible()

        // Back to an open status: the card gets its ordinary face again.
        await setListStatus(page, 'Done', 'todo')
        await expect(glyph(page, 'Done', 'todo')).toBeVisible()
        await expect(face.locator('[data-testid^="board-card-closed-"]')).toHaveCount(0)
    })

    test('the status facet narrows the board by list', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, ALPHA)
        await addCard(page, 1, BRAVO)

        await openFilter(page)
        await page
            .getByTestId('cards-filter-panel')
            .getByRole('checkbox', { name: 'In progress' })
            .click()
        await closeFilter(page)

        await expect(boardCard(page, ALPHA)).toHaveCount(0)
        await expect(boardCard(page, BRAVO)).toBeVisible()
        await expect(page.locator('[data-testid^="cards-column-count-"]').first()).toHaveText('0/1')

        await page
            .getByTestId('cards-filter-bar')
            .getByRole('button', { name: 'Clear all' })
            .click()
        await expect(boardCard(page, ALPHA)).toBeVisible()
    })

    test('board settings round-trip the auto-archive days', async ({ page }) => {
        await freshBoard(page)
        await page.getByRole('button', { name: 'Board actions' }).click()
        await page.getByTestId('cards-board-settings').click()
        const field = page.getByLabel('Auto-archive finished cards after (days)')
        await expect(field).toHaveValue('0')
        await field.fill('30')
        await page.getByTestId('cards-board-settings-save').click()
        await expect(field).toHaveCount(0)

        await page.getByRole('button', { name: 'Board actions' }).click()
        await page.getByTestId('cards-board-settings').click()
        await expect(page.getByLabel('Auto-archive finished cards after (days)')).toHaveValue('30')
    })
})
