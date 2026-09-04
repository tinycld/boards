import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, createBoard } from './helpers'

// The board as a table: the same cards as rows, headers that sort, the
// keyboard walking rows, and the choice surviving a reload.
//
// Drives the UI only — no raw PB writes.

const ALPHA = 'Alpha row'
const BRAVO = 'Bravo row'

let run = 0
async function freshBoard(page: Page): Promise<string> {
    const name = `table-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

async function rowTitles(page: Page): Promise<string[]> {
    const rows = page.getByTestId('boards-table').locator('[data-testid^="boards-row-"]')
    const titles: string[] = []
    for (const row of await rows.all()) {
        const text = (await row.textContent()) ?? ''
        if (text.includes(ALPHA)) titles.push(ALPHA)
        else if (text.includes(BRAVO)) titles.push(BRAVO)
    }
    return titles
}

test.describe('Boards — list view', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
    })

    test('shows rows, sorts by a header, walks with j, and survives a reload', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, BRAVO)
        await addCard(page, 0, ALPHA)

        await page.getByTestId('boards-view-list').click()
        const table = page.getByTestId('boards-table')
        await expect(table).toBeVisible()
        await expect.poll(() => rowTitles(page)).toEqual([BRAVO, ALPHA])
        await expect(table.locator('[data-testid^="boards-row-"]').first()).toContainText('To do')

        await page.getByRole('button', { name: 'Sort by Title' }).click()
        await expect.poll(() => rowTitles(page)).toEqual([ALPHA, BRAVO])
        await page.getByRole('button', { name: 'Sort by Title' }).click()
        await expect.poll(() => rowTitles(page)).toEqual([BRAVO, ALPHA])

        // j walks the ROWS in their sorted order.
        await page.keyboard.press('j')
        await expect(table.locator('[data-testid^="boards-focused-"]')).toHaveCount(1)
        const firstRow = table.locator('[data-testid^="boards-row-"]').first()
        await expect(firstRow.locator('[data-testid^="boards-focused-"]')).toHaveCount(1)
        await page.keyboard.press('j')
        await expect(
            table
                .locator('[data-testid^="boards-row-"]')
                .nth(1)
                .locator('[data-testid^="boards-focused-"]')
        ).toHaveCount(1)

        await page.reload()
        await expect(page.getByTestId('boards-table')).toBeVisible()
        await page.getByTestId('boards-view-board').click()
        await expect(page.getByTestId('boards-table')).toHaveCount(0)
    })
})
