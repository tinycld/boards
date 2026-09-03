import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
    login,
    navigateToPackage,
    signInAsCollaborator,
    TEST_COLLABORATOR_EMAIL,
} from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// Notifications beyond mentions, end to end: an assignment reaches the
// assignee's bell, a comment reaches a watcher, and stopping watching
// silences a move. Two sessions — the owner acts, the collaborator receives —
// each in its own browser context. The collaborator account is shared across
// the run, so every assertion measures a CHANGE from a baseline rather than
// "any unread exists".
//
// Drives the UI only — no raw PB writes.

const CARD_TITLE = 'Prepare the quarterly review'

function bell(page: Page) {
    return page.getByLabel(/^Notifications/)
}

async function unreadCount(page: Page): Promise<number> {
    const label = (await bell(page).getAttribute('aria-label')) ?? ''
    const match = label.match(/\((\d+) unread\)/)
    return match ? Number(match[1]) : 0
}

function peek(page: Page) {
    return page.getByTestId('cards-card-peek')
}

async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
}

async function addMemberToBoard(page: Page, boardName: string, email: string, role: string) {
    await page.getByRole('button', { name: 'Share board' }).click()
    await expect(page.getByText(`Share “${boardName}”`)).toBeVisible()
    await page.getByRole('button', { name: 'Add people' }).click()
    await page.getByRole('button', { name: new RegExp(`^${role} — `) }).click()
    await page.getByPlaceholder('Search by name or email').fill(email)
    await expect(page.getByText(email)).toBeVisible()
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByPlaceholder('Search by name or email')).not.toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0)
}

async function assignCollaborator(page: Page) {
    await peek(page).getByRole('button', { name: 'Assign' }).click()
    // The picker lists display NAMES, not emails; the seeded collaborator's
    // name contains "Collaborator".
    await page.getByRole('menuitem', { name: /Collaborator/ }).click()
    await expect(peek(page).getByRole('button', { name: 'Change assignees' })).toBeVisible()
    if ((await page.getByRole('menuitem').count()) > 0) await page.keyboard.press('Escape')
}

async function postComment(page: Page, text: string) {
    const composer = page.getByTestId('cards-comment-composer')
    await composer.click()
    await composer.locator('.ProseMirror').click()
    await page.keyboard.type(text, { delay: 10 })
    await page.getByRole('button', { name: /^Send$/ }).click()
    await expect(page.getByText(text)).toBeVisible()
}

test.describe('card watching and notifications', () => {
    test('assignment, a watched comment, and stopping watching', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')

        const boardName = `watch-${Date.now()}`
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)
        await addMemberToBoard(page, boardName, TEST_COLLABORATOR_EMAIL, 'Editor')

        const { page: bobPage, close } = await signInAsCollaborator(page)
        try {
            await navigateToPackage(bobPage, 'cards')
            await expect(bell(bobPage)).toBeVisible()
            let baseline = await unreadCount(bobPage)

            // --- Assignment notifies the assignee, and auto-watches them ---
            await openCard(page, CARD_TITLE)
            await assignCollaborator(page)
            await expect
                .poll(() => unreadCount(bobPage), { timeout: 20_000 })
                .toBeGreaterThan(baseline)
            // The owner created the card and the collaborator was assigned:
            // two watchers.
            await expect(peek(page).getByTestId('cards-watch-count')).toHaveText('2')

            // --- A comment reaches the watcher ---
            baseline = await unreadCount(bobPage)
            await postComment(page, 'Status update for the review')
            await expect
                .poll(() => unreadCount(bobPage), { timeout: 20_000 })
                .toBeGreaterThan(baseline)

            // --- Stop watching: a move goes unheard ---
            await navigateToPackage(bobPage, 'settings')
            await navigateToPackage(bobPage, 'cards')
            await bobPage.getByText(boardName, { exact: true }).click()
            await openCard(bobPage, CARD_TITLE)
            await bobPage.getByRole('button', { name: 'Stop watching card' }).click()
            await expect(bobPage.getByRole('button', { name: 'Watch card' })).toBeVisible()
            await expect(peek(page).getByTestId('cards-watch-count')).toHaveText('1')

            baseline = await unreadCount(bobPage)
            await peek(page).getByRole('button', { name: 'Move to Doing' }).click()
            await expect(peek(page).getByTestId('cards-activity-moved')).toBeVisible()
            // Give the notify path time it would have needed, then assert
            // silence — a bell that never moves is the whole point.
            await page.waitForTimeout(3000)
            expect(await unreadCount(bobPage)).toBe(baseline)
        } finally {
            await close()
        }
    })
})
