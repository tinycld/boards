import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, cardsInColumn, createBoard } from './helpers'

// Filtering and sorting, read back from the board: hidden cards are gone from
// the column, the count says how many, the keyboard skips them, and a sort
// refuses a within-column reorder. Every assertion is on what the user sees.
//
// Drives the UI only — no raw PB writes.

const ALPHA = 'Alpha task'
const BRAVO = 'Bravo task'

let run = 0
async function freshBoard(page: Page): Promise<string> {
    const name = `filter-${Date.now()}-${run++}`
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

async function closePeek(page: Page) {
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(peek(page)).toHaveCount(0)
}

async function setPriority(page: Page, title: string, level: string) {
    await openCard(page, title)
    await peek(page).getByRole('button', { name: 'Set priority' }).click()
    await page.getByRole('menuitem', { name: level }).click()
    await closePeek(page)
}

async function openFilter(page: Page) {
    await page.getByTestId('cards-filter-button').click()
    await expect(page.getByTestId('cards-filter-panel')).toBeVisible()
}

async function closeFilter(page: Page) {
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('cards-filter-panel')).toHaveCount(0)
}

test.describe('Cards — filtering and sorting', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('a priority filter hides the other card, counts it, and clears', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, ALPHA)
        await addCard(page, 0, BRAVO)
        await setPriority(page, ALPHA, 'High')

        await openFilter(page)
        await page.getByTestId('cards-filter-panel').getByRole('checkbox', { name: 'High' }).click()
        await closeFilter(page)

        await expect(boardCard(page, BRAVO)).toHaveCount(0)
        await expect(boardCard(page, ALPHA)).toBeVisible()
        await expect(page.locator('[data-testid^="cards-column-count-"]').first()).toHaveText('1/2')
        await expect(page.getByTestId('cards-filter-bar')).toContainText('High')

        await page.getByTestId('cards-filter-clear').click()
        await expect(boardCard(page, BRAVO)).toBeVisible()
        await expect(page.getByTestId('cards-filter-bar')).toHaveCount(0)
        await expect(page.locator('[data-testid^="cards-column-count-"]').first()).toHaveText('2')
    })

    test('a keyword narrows by title and the keyboard never lands on a hidden card', async ({
        page,
    }) => {
        await freshBoard(page)
        await addCard(page, 0, ALPHA)
        await addCard(page, 0, BRAVO)

        await openFilter(page)
        await page.getByTestId('cards-filter-text').fill('bravo')
        await closeFilter(page)
        await expect(boardCard(page, ALPHA)).toHaveCount(0)

        // j adopts the first VISIBLE card, and a second j has nowhere to go.
        await page.keyboard.press('j')
        await expect(page.locator('[data-testid^="cards-focused-"]')).toHaveCount(1)
        const focused = page.locator('[data-testid^="cards-focused-"]').first()
        const focusedId = (await focused.getAttribute('data-testid'))?.replace('cards-focused-', '')
        const bravoId = (await boardCard(page, BRAVO).getAttribute('data-testid'))?.replace(
            'board-card-',
            ''
        )
        expect(focusedId).toBe(bravoId)
        await page.keyboard.press('j')
        expect(
            (
                await page
                    .locator('[data-testid^="cards-focused-"]')
                    .first()
                    .getAttribute('data-testid')
            )?.replace('cards-focused-', '')
        ).toBe(bravoId)
    })

    test('sorting by title reorders the column and blocks a keyboard reorder', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, BRAVO)
        await addCard(page, 0, ALPHA)
        expect(await cardsInColumn(page, 'To do')).toEqual([BRAVO, ALPHA])

        await page.getByTestId('cards-sort-button').click()
        await page.getByTestId('cards-sort-title').click()
        await expect.poll(() => cardsInColumn(page, 'To do')).toEqual([ALPHA, BRAVO])

        // Shift+ArrowDown on the first card would swap them under manual
        // order; under a sort it is a no-op.
        await boardCard(page, ALPHA).click()
        await closePeek(page)
        await page.keyboard.press('j')
        await page.keyboard.press('Shift+ArrowDown')
        await expect.poll(() => cardsInColumn(page, 'To do')).toEqual([ALPHA, BRAVO])

        await page.getByTestId('cards-sort-button').click()
        await page.getByTestId('cards-sort-manual').click()
        await expect.poll(() => cardsInColumn(page, 'To do')).toEqual([BRAVO, ALPHA])
    })

    test('a filter belongs to its board', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, ALPHA)
        await openFilter(page)
        await page.getByTestId('cards-filter-text').fill('nothing matches')
        await closeFilter(page)
        await expect(boardCard(page, ALPHA)).toHaveCount(0)

        const second = await freshBoard(page)
        await expect(page.getByTestId('cards-filter-bar')).toHaveCount(0)
        await addCard(page, 0, BRAVO)
        await expect(boardCard(page, BRAVO)).toBeVisible()
        expect(second).not.toBe('')
    })
})
