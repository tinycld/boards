import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage, TEST_COLLABORATOR_EMAIL } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, closeCardPeek, createBoard, shareBoard } from './helpers'

// The cross-board list: what is mine shows up with its board and list, the
// search box narrows it, and a row opens the card without touching the
// board selection.
//
// Drives the UI only — no raw PB writes.

const MINE = 'Prepare the demo'
const OTHER = 'Someone else will do this'

let run = 0
async function freshBoard(page: Page): Promise<string> {
    const name = `mine-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

function peek(page: Page) {
    return page.getByTestId('boards-card-peek')
}

async function assignSelf(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
    await peek(page).getByRole('button', { name: 'Assign' }).click()
    await page.getByRole('menuitemcheckbox').first().click()
    await expect(peek(page).getByRole('button', { name: 'Change assignees' })).toBeVisible()
    // The multi-select menu stays open after a pick; Escape closes it. If the
    // menu had already closed, that same Escape reaches the peek and closes
    // it instead — so the peek is closed explicitly only if it is still up.
    await page.keyboard.press('Escape')
    if ((await peek(page).count()) > 0) await closeCardPeek(page)
    await expect(peek(page)).toHaveCount(0)
}

/**
 * Assign BOTH the caller and the seeded collaborator to the same card.
 *
 * Regression for a real bug: the vendored PocketBase fork makes plain `=` on
 * a multi-relation column an ALL-match, not any-match, so a naive server-side
 * "assignees = me" filter would require the caller to be the ONLY assignee —
 * this card, with two, would silently vanish from "Assigned to me". The
 * board must be shared with the collaborator first: only a board member is an
 * assignable candidate.
 */
async function assignSelfAndCollaborator(page: Page, boardName: string, title: string) {
    await shareBoard(page, boardName, TEST_COLLABORATOR_EMAIL, 'Editor')
    await boardCard(page, title).click()
    await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
    await peek(page).getByRole('button', { name: 'Assign' }).click()
    // The picker lists display NAMES, not emails, and the roster it draws
    // from (`projectMembers` — board-project.ts) is UNSORTED: with two
    // members, `.first()` for self could just as easily resolve to the
    // collaborator, and the next click would un-toggle them instead of
    // adding a second assignee. Anchor each pick by name — the seeded
    // primary account's display name is 'Test User' (scripts/seed-db.ts's
    // TEST_DEFAULTS.userName; no exported constant for it, unlike the
    // collaborator's TEST_COLLABORATOR_NAME) and the collaborator's contains
    // "Collaborator" — same anchor card-watching.spec.ts uses.
    await page.getByRole('menuitemcheckbox', { name: /Test User/ }).click()
    await page.getByRole('menuitemcheckbox', { name: /Collaborator/ }).click()
    await expect(peek(page).getByRole('button', { name: 'Change assignees' })).toBeVisible()
    await page.keyboard.press('Escape')
    if ((await peek(page).count()) > 0) await closeCardPeek(page)
    await expect(peek(page)).toHaveCount(0)
}

async function openMyCards(page: Page) {
    await page.getByTestId('boards-sidebar-my-cards').click()
    await expect(page.getByTestId('boards-my-cards')).toBeVisible()
}

test.describe('Boards — My cards', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
    })

    test('lists assigned cards with their board and list, and searches', async ({ page }) => {
        const name = await freshBoard(page)
        await addCard(page, 0, MINE)
        await addCard(page, 0, OTHER)
        await assignSelf(page, MINE)

        await openMyCards(page)
        // Scoped by board name: earlier runs leave boards carrying the same
        // card title, and a row shows its board.
        const rows = page.locator('[data-testid^="boards-row-"]')
        await expect(rows.filter({ hasText: MINE }).filter({ hasText: name })).toHaveCount(1)
        await expect(rows.filter({ hasText: OTHER })).toHaveCount(0)
        const row = rows.filter({ hasText: MINE }).filter({ hasText: name })
        await expect(row).toContainText(name)
        await expect(row).toContainText('To do')

        // All cards shows the unassigned one too. Searched first: All lists
        // every card on every board in the database and the list is
        // virtualized, so an unsearched row may not be in the DOM at all.
        await page.getByTestId('boards-my-boards-mode-all').click()
        await page.getByTestId('boards-my-boards-search').fill('someone else')
        await expect(rows.filter({ hasText: OTHER }).filter({ hasText: name })).toHaveCount(1)
        await expect(rows.filter({ hasText: MINE })).toHaveCount(0)
    })

    test('a row opens the card page', async ({ page }) => {
        const name = await freshBoard(page)
        await addCard(page, 0, MINE)
        await assignSelf(page, MINE)

        await openMyCards(page)
        await page
            .locator('[data-testid^="boards-row-"]')
            .filter({ hasText: MINE })
            .filter({ hasText: name })
            .click()
        // The full-page card: its back button reads the board's name, and the
        // body renders the description section.
        await expect(page.getByRole('button', { name: 'Back to board' })).toContainText(name)
        await expect(page.getByText('Description', { exact: true })).toBeVisible()
    })

    test('a card with more than one assignee still lists under Assigned to me', async ({
        page,
    }) => {
        const name = await freshBoard(page)
        await addCard(page, 0, MINE)
        await assignSelfAndCollaborator(page, name, MINE)

        await openMyCards(page)
        const rows = page.locator('[data-testid^="boards-row-"]')
        await expect(rows.filter({ hasText: MINE }).filter({ hasText: name })).toHaveCount(1)
    })
})
