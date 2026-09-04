import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, closeCardPeek, createBoard } from './helpers'

// The timeline view: only dated cards are drawn, a start→due card is a bar,
// j/k walk the drawn rows, Enter opens the peek, and the choice of view is
// remembered. Dates are set through the card, as everywhere else.
//
// Drives the UI only — no raw PB writes.

const DATED = 'Dated task'
const SPAN = 'Spanning task'
const UNDATED = 'Undated task'

function peek(page: Page) {
    return page.getByTestId('cards-card-peek')
}

async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
}

async function setDue(page: Page, title: string, preset: string) {
    await openCard(page, title)
    await peek(page).getByRole('button', { name: 'Set due date' }).click()
    await page.getByRole('button', { name: preset, exact: true }).click()
    await expect(peek(page).getByRole('button', { name: /^Due / })).toBeVisible()
    await closeCardPeek(page)
}

async function setStart(page: Page, title: string, preset: string) {
    await openCard(page, title)
    await peek(page).getByRole('button', { name: 'Set start date' }).click()
    await page.getByRole('button', { name: preset, exact: true }).click()
    await expect(peek(page).getByRole('button', { name: /^Start / })).toBeVisible()
    await closeCardPeek(page)
}

test.describe('Cards — timeline view', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('draws dated cards, walks them, opens one, and remembers the view', async ({ page }) => {
        const board = `timeline-${Date.now()}`
        await createBoard(page, board)
        await addCard(page, 0, DATED)
        await addCard(page, 0, SPAN)
        await addCard(page, 0, UNDATED)
        await setDue(page, DATED, 'Today')
        await setStart(page, SPAN, 'Today')
        await setDue(page, SPAN, 'Next week')

        await page.getByTestId('cards-view-timeline').click()
        const timeline = page.getByTestId('cards-board-timeline')
        await expect(timeline).toBeVisible()
        const rows = timeline.locator('[data-testid^="cards-timeline-row-"]')
        await expect(rows).toHaveCount(2)
        await expect(timeline.getByTestId('cards-timeline-bar')).toHaveCount(1)
        await expect(timeline.getByTestId('cards-timeline-point')).toHaveCount(1)
        await expect(timeline.getByTestId('cards-timeline-today')).toBeVisible()
        await expect(timeline.getByText(UNDATED)).toHaveCount(0)

        // The view toggle still holds DOM focus, and Enter on a focused
        // button activates the button rather than the board shortcut — so
        // move focus onto the timeline first (the axis has no handler).
        await timeline.getByTestId('cards-timeline-today').click()

        // j adopts the first drawn row; Enter opens it.
        await page.keyboard.press('j')
        await expect(timeline.locator('[data-testid^="cards-focused-"]')).toHaveCount(1)
        await page.keyboard.press('j')
        await page.keyboard.press('Enter')
        await expect(peek(page)).toBeVisible()
        await closeCardPeek(page)

        // The view is remembered per board across in-app navigation.
        await navigateToPackage(page, 'settings')
        await navigateToPackage(page, 'cards')
        await expect(page.getByTestId('cards-board-timeline')).toBeVisible()
        await page.getByTestId('cards-view-board').click()
        await expect(boardCard(page, UNDATED)).toBeVisible()
    })
})
