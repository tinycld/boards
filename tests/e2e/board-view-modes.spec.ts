import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, cardsInColumn, createBoard, dragCardToColumn } from './helpers'

// Collapsed columns and card density: both are per-user view preferences
// held in the Zustand store, so nothing here touches the server. Every spec
// creates its own uniquely-named board and drives the UI only.
//
// These have now been executed and pass, including the drop-after-collapse
// case the original note flagged as most likely to need adjusting — the 40px
// spine does accept a drop, so no change was needed in BoardColumn.
//
// Note when running these from a git worktree: playwright's testDir resolves
// through node_modules/@tinycld/cards, which symlinks to the main checkout — so
// a run launched from a worktree exercises that checkout, not the worktree.

let run = 0
async function freshBoard(page: import('@playwright/test').Page, label: string): Promise<string> {
    const name = `view-${label}-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

/** Collapse a list through its column menu — the discoverable entry point. */
async function collapseList(page: import('@playwright/test').Page, name: string) {
    await page.getByLabel(`${name} list actions`).click()
    await page.getByText('Collapse list', { exact: true }).click()
    await expect(page.getByLabel(`Expand ${name} list`)).toBeVisible()
}

test.describe('Cards — collapsed columns and card density', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('collapses a list, hides its cards, and expands again', async ({ page }) => {
        await freshBoard(page, 'collapse')
        await addCard(page, 0, 'hidden by collapse')

        const card = boardCard(page, 'hidden by collapse')
        await expect(card).toBeVisible()

        await collapseList(page, 'To do')
        // The spine replaces the stack outright — the collapsed column carries
        // its own drop bounds, so nothing needs to stay mounted behind it.
        await expect(card).not.toBeAttached()

        await page.getByLabel('Expand To do list').click()
        await expect(card).toBeVisible()
    })

    test('double-clicking the list header collapses it', async ({ page }) => {
        await freshBoard(page, 'dblclick')

        // The shortcut for the menu item — the header title is the target, so
        // the gesture never competes with the menu button beside it.
        await page.getByLabel('To do list — double tap to collapse').dblclick()

        await expect(page.getByLabel('Expand To do list')).toBeVisible()
    })

    test('a collapsed list shows its name down the spine', async ({ page }) => {
        await freshBoard(page, 'spine-name')

        await collapseList(page, 'To do')

        // The vertical name is real text, not an image or an aria-only label —
        // writingMode reflows it, so it stays copyable and searchable.
        await expect(page.getByLabel('Expand To do list')).toContainText('To do')
    })

    test('a collapsed list still shows its card count', async ({ page }) => {
        await freshBoard(page, 'count')
        await addCard(page, 0, 'one')
        await addCard(page, 0, 'two')

        await collapseList(page, 'To do')

        // The count is the collapsed face's primary element — if it went
        // missing the spine would say nothing at all.
        await expect(page.getByLabel('Expand To do list')).toContainText('2')
    })

    /**
     * The regression this feature is most likely to cause.
     *
     * Collapsing narrows a column from 284 to 40, shifting every column to its
     * right. findTargetColumn hit-tests against bounds stored at drag start and
     * on canvas scroll — neither fires for a width change — so without the
     * re-measure in BoardCanvas, this drop lands in whichever column used to
     * occupy that x.
     */
    test('drops into the correct column after a collapse shifts the board', async ({ page }) => {
        await freshBoard(page, 'stale-bounds')
        await addCard(page, 1, 'travels right')

        // Collapse the LEFTMOST list, so both columns involved in the drag
        // move left underneath the stale bounds.
        await collapseList(page, 'To do')

        await dragCardToColumn(page, boardCard(page, 'travels right'), 'Done')

        await expect(async () => {
            expect(await cardsInColumn(page, 'Done')).toContain('travels right')
        }).toPass()
    })

    test('density toggle switches card faces and survives a reload', async ({ page }) => {
        await freshBoard(page, 'density')
        await addCard(page, 0, 'dense me')

        const toggle = page.getByTestId('cards-density-toggle')
        await expect(toggle).toHaveAttribute('aria-label', 'Hide card details')

        await toggle.click()
        await expect(toggle).toHaveAttribute('aria-label', 'Show card details')
        // The card face swaps, but the card itself must still be there and
        // still open — compact hides detail, it does not hide work.
        await expect(boardCard(page, 'dense me')).toBeVisible()

        await page.reload()
        await expect(page.getByTestId('cards-density-toggle')).toHaveAttribute(
            'aria-label',
            'Show card details'
        )

        // Restore, so a persisted preference does not leak into later specs
        // sharing this browser profile.
        await page.getByTestId('cards-density-toggle').click()
        await expect(page.getByTestId('cards-density-toggle')).toHaveAttribute(
            'aria-label',
            'Hide card details'
        )
    })

    test('a collapsed list survives a reload', async ({ page }) => {
        await freshBoard(page, 'persist')
        await addCard(page, 0, 'still hidden')

        await collapseList(page, 'To do')
        await page.reload()

        await expect(page.getByLabel('Expand To do list')).toBeVisible()
        await expect(boardCard(page, 'still hidden')).not.toBeAttached()

        await page.getByLabel('Expand To do list').click()
        await expect(boardCard(page, 'still hidden')).toBeVisible()
    })
})
