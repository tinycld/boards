import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, closeCardPeek, createBoard } from './helpers'

// Priority end to end: the picker writes the field, the board face renders
// the glyph, and the compact face keeps it. Every assertion reads the FACE
// back rather than the chip alone — the chip is optimistic, the face is what
// the live query re-emits once the server has the row.
//
// Drives the UI only — no raw PB writes.

const CARD_TITLE = 'Investigate the outage'

let run = 0
async function freshBoard(page: Page): Promise<string> {
    const name = `priority-${Date.now()}-${run++}`
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

test.describe('Cards — priority', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('sets a priority from the card, shows it on the face, and clears it', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, CARD_TITLE)
        const face = boardCard(page, CARD_TITLE)
        // A new card has no priority, and the face must not pretend otherwise.
        await expect(face.locator('[data-testid^="cards-priority-"]')).toHaveCount(0)

        await openCard(page, CARD_TITLE)
        await peek(page).getByRole('button', { name: 'Set priority' }).click()
        await page.getByRole('menuitem', { name: 'High' }).click()

        const chip = peek(page).getByRole('button', { name: /Priority High/ })
        await expect(chip).toBeVisible()
        await expect(face.getByTestId('cards-priority-high')).toBeVisible()

        // Compact faces keep the glyph: lateness and urgency are the two cues
        // the dense face exists to preserve. The peek covers the header's
        // right edge where the toggle lives, so it is closed first.
        await closeCardPeek(page)
        await page.getByTestId('cards-density-toggle').click()
        await expect(face.getByTestId('cards-priority-high')).toBeVisible()
        await page.getByTestId('cards-density-toggle').click()

        // Back to none: a real value in the picker, not a separate clear.
        await openCard(page, CARD_TITLE)
        await peek(page)
            .getByRole('button', { name: /Priority High/ })
            .click()
        await page.getByRole('menuitem', { name: 'No priority' }).click()
        await expect(peek(page).getByRole('button', { name: 'Set priority' })).toBeVisible()
        await expect(face.locator('[data-testid^="cards-priority-"]')).toHaveCount(0)
    })

    test('a priority survives leaving and reopening the board', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await peek(page).getByRole('button', { name: 'Set priority' }).click()
        await page.getByRole('menuitem', { name: 'Urgent' }).click()
        await expect(boardCard(page, CARD_TITLE).getByTestId('cards-priority-urgent')).toBeVisible()

        // In-app navigation rather than a reload, for the reasons
        // card-editing.spec.ts documents.
        await navigateToPackage(page, 'settings')
        await navigateToPackage(page, 'cards')
        await expect(boardCard(page, CARD_TITLE).getByTestId('cards-priority-urgent')).toBeVisible()
    })
})
