import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import {
    addCard,
    boardCard,
    closeCardPeek,
    createBoard,
    dragCardToSection,
    openCard,
} from './helpers'

// A sprint's life: planned, started, completed with the unfinished work
// rolled into a new sprint. Drives the UI only — the transitions go through
// their endpoints, which is the only way the server lets a sprint's stamps
// be written.

let run = 0
async function freshSprintBoard(page: Page, label: string) {
    const name = `lifecycle-${label}-${Date.now()}-${run++}`
    await createBoard(page, name)
    await page.getByLabel('Board actions').click()
    await page.getByTestId('boards-settings').click()
    await page.getByLabel('Plan work in sprints').click()
    await page.getByTestId('boards-settings-save').click()
    await expect(page.getByTestId('boards-view-backlog')).toBeVisible()
    return name
}

const section = (page: Page, title: string) =>
    page.getByTestId(/^boards-section-(?!title-|receiving|backlog)/).filter({
        has: page.getByTestId(/^boards-section-title-/).filter({ hasText: title }),
    })

const row = (page: Page, title: string) =>
    page
        .getByTestId(/^boards-row-/)
        .filter({ hasText: title })
        .first()

function peek(page: Page) {
    return page.getByTestId('boards-card-peek')
}

test.describe('Boards — sprint lifecycle', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
    })

    test('starts a sprint and completes it into a new one', async ({ page }) => {
        await freshSprintBoard(page, 'roll')
        await addCard(page, 0, 'finished work')
        await addCard(page, 0, 'open work')

        await page.getByTestId('boards-view-backlog').click()
        await page.getByTestId('boards-new-sprint').click()
        await page.getByTestId('boards-sprint-save').click()
        await expect(section(page, 'Sprint 1')).toBeVisible()
        await dragCardToSection(page, row(page, 'finished work'), 'Sprint 1')
        await expect(section(page, 'Sprint 1').getByText('finished work')).toBeVisible()
        await dragCardToSection(page, row(page, 'open work'), 'Sprint 1')
        await expect(section(page, 'Sprint 1').getByText('open work')).toBeVisible()

        // Start: the dialog confirms the dates the board's length suggests.
        await page.getByTestId('boards-sprint-start-1').click()
        await page.getByTestId('boards-start-sprint-confirm').click()
        await expect(page.getByTestId('boards-start-sprint-dialog')).toHaveCount(0)
        await expect(page.getByTestId('boards-sprint-complete-1')).toBeVisible()

        // Once active it is what the canvas scopes to; finish one card there
        // through the peek's list stepper. A button, not a drag: the drag
        // path has its own specs, and this one is about the lifecycle.
        await page.getByTestId('boards-view-board').click()
        await expect(page.getByTestId('boards-sprint-scope')).toContainText('Sprint 1')
        await openCard(page, 'finished work')
        await peek(page).getByRole('button', { name: 'Move to Done' }).click()
        // The closed face renders from the card's data, so its appearance is
        // the move having been written before the view changes underneath it.
        await expect(
            boardCard(page, 'finished work').getByTestId(/^boards-card-closed-/)
        ).toBeVisible()
        await closeCardPeek(page)
        await page.getByTestId('boards-view-backlog').click()

        // Complete: one done, one unfinished; the unfinished card rolls into
        // a sprint the server plans for it.
        await page.getByTestId('boards-sprint-complete-1').click()
        const dialog = page.getByTestId('boards-complete-sprint-dialog')
        await expect(dialog).toContainText('1 card done · 1 unfinished')
        await dialog.getByTestId('boards-complete-new').click()
        await dialog.getByTestId('boards-complete-sprint-confirm').click()
        await expect(dialog).toHaveCount(0)

        await expect(section(page, 'Sprint 2').getByText('open work')).toBeVisible()
        await expect(section(page, 'Sprint 2').getByText('finished work')).toHaveCount(0)
        // The finished card stays in the sprint it finished in, now completed.
        await expect(page.getByTestId('boards-completed-sprints')).toContainText('Completed (1)')
        await expect(section(page, 'Sprint 1').getByText('finished work')).toBeVisible()
        await expect(section(page, 'Sprint 1').getByText('open work')).toHaveCount(0)

        // The rollover is one attributed history row, not two.
        await page.getByTestId('boards-view-board').click()
        await page.getByTestId('boards-sprint-scope').click()
        await page.getByTestId('boards-scope-all').click()
        await boardCard(page, 'open work').click()
        await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
        const sprintRows = peek(page).getByTestId('boards-activity-sprint')
        await expect(sprintRows).toHaveText([
            /added this to Sprint 1/,
            /moved this from Sprint 1 to Sprint 2/,
        ])
    })

    test('the scope pill starts the next planned sprint', async ({ page }) => {
        await freshSprintBoard(page, 'pill')
        await addCard(page, 0, 'pill work')
        await page.getByTestId('boards-view-backlog').click()
        await page.getByTestId('boards-new-sprint').click()
        await page.getByTestId('boards-sprint-save').click()
        await expect(section(page, 'Sprint 1')).toBeVisible()

        await page.getByTestId('boards-view-board').click()
        await page.getByTestId('boards-sprint-scope').click()
        await page.getByTestId('boards-scope-start-sprint').click()
        await page.getByTestId('boards-start-sprint-confirm').click()
        await expect(page.getByTestId('boards-sprint-scope')).toContainText('Sprint 1')
        // An unfiled card is outside the active sprint's scope.
        await expect(boardCard(page, 'pill work')).toHaveCount(0)
    })
})
