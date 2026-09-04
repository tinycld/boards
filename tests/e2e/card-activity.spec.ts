import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// Card history, read back from the Activity section: creating, moving,
// assigning and setting a due date each leave a sentence, in order, and the
// sentences survive leaving and reopening the card.
//
// Drives the UI only — no raw PB writes.

const CARD_TITLE = 'Trace the outage'

let run = 0
async function freshBoard(page: Page): Promise<string> {
    const name = `activity-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

function peek(page: Page) {
    return page.getByTestId('boards-card-peek')
}

async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
}

test.describe('Boards — activity history', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
    })

    test('records creation, a move, an assignment and a due date in order', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        await expect(peek(page).getByTestId('boards-activity-created')).toContainText(
            'created this card'
        )

        // Move via the list stepper's second segment.
        await peek(page).getByRole('button', { name: 'Move to Doing' }).click()
        await expect(peek(page).getByTestId('boards-activity-moved')).toContainText(
            'moved this from To do to Doing'
        )

        await peek(page).getByRole('button', { name: 'Assign' }).click()
        await page.getByRole('menuitem').first().click()
        await expect(peek(page).getByRole('button', { name: 'Change assignees' })).toBeVisible()
        // The multi-select stays open after a pick; Escape closes it. Pressing
        // Escape with the menu already gone would close the peek instead.
        if ((await page.getByRole('menuitem').count()) > 0) await page.keyboard.press('Escape')
        await expect(peek(page).getByTestId('boards-activity-assignee_added')).toContainText(
            'assigned'
        )

        await peek(page).getByRole('button', { name: 'Set due date' }).click()
        await page.getByRole('button', { name: 'Tomorrow' }).click()
        await expect(peek(page).getByTestId('boards-activity-due')).toContainText(
            'set the due date to'
        )

        const rows = peek(page).locator('[data-testid^="boards-activity-"]')
        await expect(rows).toHaveCount(4)
        expect(
            await rows.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-testid')))
        ).toEqual([
            'boards-activity-created',
            'boards-activity-moved',
            'boards-activity-assignee_added',
            'boards-activity-due',
        ])

        // Persisted, not just optimistic: navigate away in-app and back.
        await navigateToPackage(page, 'settings')
        await navigateToPackage(page, 'boards')
        await openCard(page, CARD_TITLE)
        await expect(peek(page).locator('[data-testid^="boards-activity-"]')).toHaveCount(4)
    })
})
