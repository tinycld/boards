import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, cardsInColumn, closeCardPeek, createBoard } from './helpers'

// Estimates end to end: the picker writes the field, the face shows the pill,
// the column header sums what it shows, the filter and sort read it, and the
// history records it. Every assertion reads the FACE or the header back
// rather than the chip alone — the chip is optimistic, the face is what the
// live query re-emits once the server has the row.
//
// Drives the UI only — no raw PB writes.

const ALPHA = 'Alpha task'
const BRAVO = 'Bravo task'

let run = 0
async function freshBoard(page: Page): Promise<string> {
    const name = `estimate-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

function peek(page: Page) {
    return page.getByTestId('cards-card-peek')
}

function columnTotal(page: Page) {
    return page.locator('[data-testid^="cards-column-estimate-"]').first()
}

async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
}

async function setEstimate(page: Page, title: string, points: string) {
    await openCard(page, title)
    await peek(page).getByRole('button', { name: 'Set estimate' }).click()
    await page.getByRole('menuitem', { name: points, exact: true }).click()
    await closeCardPeek(page)
}

async function openFilter(page: Page) {
    await page.getByTestId('cards-filter-button').click()
    await expect(page.getByTestId('cards-filter-panel')).toBeVisible()
}

async function closeFilter(page: Page) {
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('cards-filter-panel')).toHaveCount(0)
}

test.describe('Cards — estimates', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('sets an estimate, sums it in the column, records it, and clears it', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, ALPHA)
        await addCard(page, 0, BRAVO)
        const face = boardCard(page, ALPHA)
        // A new card has no estimate, and neither the face nor the column
        // header pretends otherwise.
        await expect(face.getByTestId('cards-estimate-pill')).toHaveCount(0)
        await expect(columnTotal(page)).toHaveCount(0)

        await openCard(page, ALPHA)
        await peek(page).getByRole('button', { name: 'Set estimate' }).click()
        await page.getByRole('menuitem', { name: '5 pts', exact: true }).click()

        await expect(peek(page).getByRole('button', { name: /Estimate 5 pts/ })).toBeVisible()
        await expect(face.getByTestId('cards-estimate-pill')).toHaveText('5 pts')
        await expect(columnTotal(page)).toHaveText('5 pts')
        await expect(peek(page).getByTestId('cards-activity-estimate')).toContainText(
            'set the estimate to 5 pts'
        )
        await closeCardPeek(page)

        // The header is a SUM over the column, not the last card's value.
        await setEstimate(page, BRAVO, '3 pts')
        await expect(columnTotal(page)).toHaveText('8 pts')

        // Clearing is its own row, and the pill and the total follow.
        await openCard(page, ALPHA)
        await peek(page)
            .getByRole('button', { name: /Estimate 5 pts/ })
            .click()
        await page.getByRole('menuitem', { name: 'Clear estimate' }).click()
        await expect(peek(page).getByRole('button', { name: 'Set estimate' })).toBeVisible()
        await expect(face.getByTestId('cards-estimate-pill')).toHaveCount(0)
        await expect(columnTotal(page)).toHaveText('3 pts')
    })

    test('the estimate facet filters, the sort orders, and the table lists it', async ({
        page,
    }) => {
        await freshBoard(page)
        await addCard(page, 0, ALPHA)
        await addCard(page, 0, BRAVO)
        await setEstimate(page, BRAVO, '8 pts')

        await openFilter(page)
        await page
            .getByTestId('cards-filter-panel')
            .getByRole('checkbox', { name: 'Unestimated' })
            .click()
        await closeFilter(page)
        await expect(boardCard(page, BRAVO)).toHaveCount(0)
        await expect(boardCard(page, ALPHA)).toBeVisible()
        // The total follows the filter: nothing shown is estimated.
        await expect(columnTotal(page)).toHaveCount(0)

        await page
            .getByTestId('cards-filter-bar')
            .getByRole('button', { name: 'Clear all' })
            .click()
        await expect(boardCard(page, BRAVO)).toBeVisible()

        // Ascending by estimate: the estimated card first, the unestimated last
        // — whichever direction, a card with nothing to sort by goes to the end.
        await page.getByTestId('cards-sort-button').click()
        await page.getByTestId('cards-sort-estimate').click()
        await expect.poll(() => cardsInColumn(page, 'To do')).toEqual([BRAVO, ALPHA])

        await page.getByTestId('cards-view-list').click()
        const row = page.getByTestId('cards-board-table').locator('[data-testid^="cards-row-"]', {
            hasText: BRAVO,
        })
        await expect(row).toContainText('8 pts')
        await page.getByTestId('cards-view-board').click()
    })
})
