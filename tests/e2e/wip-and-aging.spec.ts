import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// WIP limits and card aging end to end: the column menu sets a limit, the
// header reads it back, a filter does NOT relax it, and board settings
// round-trip the aging threshold.
//
// The tint itself is not driven here. It needs a card that entered its column
// days ago, and there is no honest way to age one through the UI — the stamp is
// server-owned precisely so a client cannot backdate it. The level boundaries
// are unit-tested in tests/aging.test.ts, the same split list-status.spec.ts
// uses for the time-based auto-archive sweep.
//
// Drives the UI only — no raw PB writes.

const ALPHA = 'Alpha task'
const BRAVO = 'Bravo task'
const CHARLIE = 'Charlie task'

let run = 0
async function freshBoard(page: Page) {
    await createBoard(page, `wip-${Date.now()}-${run++}`)
}

/** The first column's count badge — "To do", which addCard(0) fills. */
function firstCount(page: Page) {
    return page.locator('[data-testid^="boards-column-count-"]').first()
}

function wipWarning(page: Page) {
    return page.locator('[data-testid^="boards-column-wip-"]')
}

async function setWipLimit(page: Page, listName: string, limit: string) {
    await page.getByRole('button', { name: `${listName} list actions` }).click()
    await page.getByTestId('boards-column-wip-limit').click()
    await page.getByLabel('Cards allowed in this column').fill(limit)
    await page.getByTestId('boards-wip-save').click()
    await expect(page.getByTestId('boards-wip-save')).toHaveCount(0)
}

test.describe('Boards — WIP limits and aging', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
    })

    test('a limit colours the column count and warns once it is exceeded', async ({ page }) => {
        await freshBoard(page)

        // No limit: the badge is the plain count it always was.
        await addCard(page, 0, ALPHA)
        await expect(firstCount(page)).toHaveText('1')
        await expect(wipWarning(page)).toHaveCount(0)

        await setWipLimit(page, 'To do', '2')
        await expect(firstCount(page)).toHaveText('1 / 2')
        await expect(wipWarning(page)).toHaveCount(0)

        // Exactly on the limit is its own state — full, but not yet a warning.
        await addCard(page, 0, BRAVO)
        await expect(firstCount(page)).toHaveText('2 / 2')
        await expect(wipWarning(page)).toHaveCount(0)

        // Over it.
        await addCard(page, 0, CHARLIE)
        await expect(firstCount(page)).toHaveText('3 / 2')
        await expect(wipWarning(page)).toBeVisible()
    })

    // The case the whole design turns on: a filter must not make an over-full
    // column read as healthy. The count is the column's TOTAL, always.
    test('a filter does not relax the limit', async ({ page }) => {
        await freshBoard(page)
        await setWipLimit(page, 'To do', '1')
        await addCard(page, 0, ALPHA)
        await addCard(page, 0, BRAVO)
        await expect(firstCount(page)).toHaveText('2 / 1')
        await expect(wipWarning(page)).toBeVisible()

        // Narrow the board to one of the two cards.
        await page.getByTestId('boards-filter-button').click()
        await expect(page.getByTestId('boards-filter-panel')).toBeVisible()
        await page.getByTestId('boards-filter-panel').getByPlaceholder('Title or key').fill(ALPHA)
        await page.keyboard.press('Escape')
        await expect(boardCard(page, BRAVO)).toHaveCount(0)

        // The column still reports both cards, and still warns.
        await expect(firstCount(page)).toHaveText('2 / 1')
        await expect(wipWarning(page)).toBeVisible()
    })

    test('the limit round-trips, and zero clears it', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, ALPHA)
        await setWipLimit(page, 'To do', '4')

        // Reopening shows the stored value, and the menu row states it.
        await page.getByRole('button', { name: 'To do list actions' }).click()
        await expect(page.getByTestId('boards-column-wip-limit')).toContainText('WIP limit: 4')
        await page.getByTestId('boards-column-wip-limit').click()
        await expect(page.getByLabel('Cards allowed in this column')).toHaveValue('4')
        await page.getByText('Cancel', { exact: true }).click()

        await setWipLimit(page, 'To do', '0')
        await expect(firstCount(page)).toHaveText('1')
    })

    test('board settings round-trip the aging threshold', async ({ page }) => {
        await freshBoard(page)
        await page.getByRole('button', { name: 'Board actions' }).click()
        await page.getByTestId('boards-settings').click()

        const field = page.getByLabel('Highlight cards untouched for (days)')
        await expect(field).toHaveValue('0')
        await field.fill('14')
        await page.getByTestId('boards-settings-save').click()
        await expect(field).toHaveCount(0)

        await page.getByRole('button', { name: 'Board actions' }).click()
        await page.getByTestId('boards-settings').click()
        await expect(page.getByLabel('Highlight cards untouched for (days)')).toHaveValue('14')
    })

    // Off by default: a card created now is fresh, and no board that has not
    // opted in shows a tint at all.
    test('no card is tinted while aging is off', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, ALPHA)
        await expect(page.locator('[data-testid^="boards-card-aging-"]')).toHaveCount(0)
    })
})
