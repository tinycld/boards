import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, cardsInColumn, createBoard } from './helpers'

// Multi-select and the bulk bar end to end: the gestures that build a
// selection, and each action reading back off the FACE rather than the bar —
// the bar is optimistic, the face is what the live query re-emits once the
// server has the rows.
//
// Drives the UI only — no raw PB writes, per the package's testing rules.

const CARDS = ['Alpha task', 'Bravo task', 'Charlie task', 'Delta task']

let run = 0
async function freshBoard(page: Page): Promise<string> {
    const name = `bulk-${Date.now()}-${run++}`
    await createBoard(page, name)
    for (const title of CARDS) await addCard(page, 0, title)
    return name
}

const bar = (page: Page) => page.getByTestId('boards-bulk-bar')

/** The zero-size marker each selected face renders — a tint is not queryable. */
function selectedMarker(page: Page, cardId?: string) {
    return page.locator(
        cardId ? `[data-testid="boards-selected-${cardId}"]` : '[data-testid^="boards-selected-"]'
    )
}

async function selectedCount(page: Page): Promise<number> {
    return selectedMarker(page).count()
}

test.describe('Boards — bulk operations', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
    })

    test('shift-click selects a range and bulk-labels every card in it', async ({ page }) => {
        await freshBoard(page)

        // A plain click with nothing selected still opens the card, so the
        // selection starts with a modified click.
        await boardCard(page, CARDS[0]).click({ modifiers: ['ControlOrMeta'] })
        await expect(bar(page)).toBeVisible()
        await boardCard(page, CARDS[2]).click({ modifiers: ['Shift'] })

        // Alpha..Charlie inclusive — the range covers what lies BETWEEN the
        // anchor and the click, not just the two ends.
        await expect(page.getByTestId('boards-bulk-count')).toHaveText('3 selected')
        expect(await selectedCount(page)).toBe(3)

        // A new board has no labels, so the bar's picker offers its manager —
        // the same empty-state path the card detail takes.
        await page.getByTestId('boards-bulk-label').click()
        await page.getByText('Manage labels…', { exact: true }).click()
        await page.getByRole('button', { name: 'New label' }).click()
        await page.getByPlaceholder('Label name').fill('blocked')
        await page.keyboard.press('Enter')
        await expect(page.getByRole('button', { name: 'Edit blocked' })).toBeVisible()
        await page.getByRole('button', { name: 'Close' }).last().click()

        // The selection survives the manager — it is the bar's own dialog, and
        // losing the selection to it would make labelling a range impossible.
        await expect(page.getByTestId('boards-bulk-count')).toHaveText('3 selected')
        await page.getByTestId('boards-bulk-label').click()
        await page.getByRole('menuitem', { name: 'blocked' }).click()

        // Read the label back off each FACE. The bar clears on success, which
        // is itself the signal the writes landed.
        await expect(bar(page)).toHaveCount(0)
        for (const title of CARDS.slice(0, 3)) {
            await expect(boardCard(page, title).getByText('blocked', { exact: true })).toBeVisible()
        }
        await expect(boardCard(page, CARDS[3]).getByText('blocked', { exact: true })).toHaveCount(0)
    })

    test('⌘-click toggles one card without collapsing the selection', async ({ page }) => {
        await freshBoard(page)

        await boardCard(page, CARDS[0]).click({ modifiers: ['ControlOrMeta'] })
        await boardCard(page, CARDS[1]).click({ modifiers: ['ControlOrMeta'] })
        await expect(page.getByTestId('boards-bulk-count')).toHaveText('2 selected')

        // Toggling the second off must leave the first selected — the drive CI
        // failure this gesture's logic guards against was a modified click
        // falling through and REPLACING the whole selection.
        await boardCard(page, CARDS[1]).click({ modifiers: ['ControlOrMeta'] })
        await expect(page.getByTestId('boards-bulk-count')).toHaveText('1 selected')
        expect(await selectedCount(page)).toBe(1)
    })

    test('bulk-moves a selection into another list, keeping its order', async ({ page }) => {
        const name = await freshBoard(page)

        await boardCard(page, CARDS[0]).click({ modifiers: ['ControlOrMeta'] })
        await boardCard(page, CARDS[1]).click({ modifiers: ['Shift'] })
        await page.getByTestId('boards-bulk-move').click()
        await page.getByRole('menuitem', { name: 'Doing', exact: true }).click()

        await expect(bar(page)).toHaveCount(0)
        // Distinct ranks in selection order — one rank for all of them would
        // leave the order to the id tiebreaker.
        expect(await cardsInColumn(page, 'Doing')).toEqual([CARDS[0], CARDS[1]])
        expect(await cardsInColumn(page, 'To do')).toEqual([CARDS[2], CARDS[3]])
        expect(name).toBeTruthy()
    })

    test('bulk-archives a selection and the cards leave the board', async ({ page }) => {
        await freshBoard(page)

        await boardCard(page, CARDS[0]).click({ modifiers: ['ControlOrMeta'] })
        await boardCard(page, CARDS[1]).click({ modifiers: ['Shift'] })
        await page.getByTestId('boards-bulk-archive').click()

        await expect(bar(page)).toHaveCount(0)
        await expect(boardCard(page, CARDS[0])).toHaveCount(0)
        await expect(boardCard(page, CARDS[1])).toHaveCount(0)
        expect(await cardsInColumn(page, 'To do')).toEqual([CARDS[2], CARDS[3]])

        // They are archived, not deleted — the panel is where they went.
        await page.getByTestId('boards-archived-button').click()
        const panel = page.getByTestId('boards-archived-panel')
        await expect(panel.getByText(CARDS[0], { exact: true })).toBeVisible()
        await expect(panel.getByText(CARDS[1], { exact: true })).toBeVisible()
    })

    test('drops the selection when the filter changes', async ({ page }) => {
        await freshBoard(page)

        await boardCard(page, CARDS[0]).click({ modifiers: ['ControlOrMeta'] })
        await boardCard(page, CARDS[1]).click({ modifiers: ['Shift'] })
        await expect(bar(page)).toBeVisible()

        // A selected card the new filter hides is invisible but still targeted
        // by the next bulk action, so the selection goes with the filter.
        await page.getByTestId('boards-filter-button').click()
        await page.getByTestId('boards-filter-panel').getByPlaceholder('Title or key').fill('Delta')

        await expect(bar(page)).toHaveCount(0)
        expect(await selectedCount(page)).toBe(0)
    })

    test('a plain click re-aims the selection rather than opening a card', async ({ page }) => {
        await freshBoard(page)

        await boardCard(page, CARDS[0]).click({ modifiers: ['ControlOrMeta'] })
        await boardCard(page, CARDS[3]).click()

        // The selection is the mode: while one stands, a plain click narrows it
        // instead of popping the peek, so a user can always shrink a selection
        // without first clearing it.
        await expect(page.getByTestId('boards-card-peek')).toHaveCount(0)
        await expect(page.getByTestId('boards-bulk-count')).toHaveText('1 selected')
        await expect(selectedMarker(page)).toHaveCount(1)
    })
})
