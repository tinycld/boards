import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard, uniqueBoardKey, uniqueStamp } from './helpers'

/**
 * An open card belongs to the board, not to the reader's view of it.
 *
 * The board's filter decides which faces the board shows. It does not decide
 * which card a peek or a page may show: the card a reader is working on stays
 * open when an edit takes it out of the filter, and a page reaches every card
 * on the board.
 *
 * These open the cards from inside the app rather than by a deep link
 * (`page.goto('/a/boards/KEY/2')`): a filter is session-only state
 * (boards-ui-store), so the reload a goto makes would drop it, and the link
 * would no longer point at a hidden card.
 */

const ALPHA = 'Alpha task'
const BRAVO = 'Bravo task'

function peek(page: Page) {
    return page.getByTestId('boards-card-peek')
}

function visibleCardPage(page: Page) {
    return page.getByTestId('boards-card-page').filter({ visible: true })
}

async function openPeek(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
}

/** The priority control: `Set priority` while unset, `Priority High. Change…` once set. */
async function setPeekPriority(page: Page, level: string) {
    await peek(page)
        .getByRole('button', { name: /^(Set priority|Priority .*Change priority)$/ })
        .click()
    await page.getByRole('menuitem', { name: level }).click()
}

/** A board with Alpha (High) and Bravo, filtered to High: Bravo is hidden. */
async function boardFilteredToAlpha(page: Page): Promise<string> {
    const name = `filtered-open-${uniqueStamp()}`
    const key = uniqueBoardKey(name)
    await createBoard(page, name, key)
    await addCard(page, 0, ALPHA)
    await addCard(page, 0, BRAVO)

    await openPeek(page, ALPHA)
    await setPeekPriority(page, 'High')
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(peek(page)).toHaveCount(0)

    await page.getByTestId('boards-filter-button').click()
    await page.getByTestId('boards-filter-panel').getByRole('checkbox', { name: 'High' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('boards-filter-panel')).toHaveCount(0)
    await expect(boardCard(page, BRAVO)).toHaveCount(0)
    return key
}

test.describe('a card the filter hides', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
    })

    test('stays open in the peek when an edit takes it out of the filter', async ({ page }) => {
        const key = await boardFilteredToAlpha(page)
        await openPeek(page, ALPHA)

        await setPeekPriority(page, 'Low')

        // Gone from the board, still the card being read.
        await expect(boardCard(page, ALPHA)).toHaveCount(0)
        await expect(peek(page).getByTestId('boards-detail-key')).toHaveText(`${key}-1`)
        await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/${key}-1$`))
    })

    test('is reached from a page by j, and the page renders it', async ({ page }) => {
        const key = await boardFilteredToAlpha(page)
        await openPeek(page, ALPHA)
        await peek(page).getByLabel('Open full page').click()
        await expect(visibleCardPage(page).getByTestId('boards-detail-key')).toHaveText(`${key}-1`)

        await page.keyboard.press('j')

        await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/2$`))
        await expect(visibleCardPage(page).getByTestId('boards-detail-key')).toHaveText(`${key}-2`)
    })
})
