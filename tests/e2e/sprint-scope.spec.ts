import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard, dragCardToSection } from './helpers'

// The sprint scope: on a board that plans in sprints, the canvas, table and
// timeline show one sprint's cards (the active one by default), and the
// header pill switches to all cards, the backlog, or a planned sprint.

let run = 0
const sprintSection = (page: import('@playwright/test').Page) =>
    page.getByTestId(/^boards-section-(?!title-|receiving|backlog)/).first()
const row = (page: import('@playwright/test').Page, title: string) =>
    page
        .getByTestId(/^boards-row-/)
        .filter({ hasText: title })
        .first()

test.describe('Boards — sprint scope', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
    })

    test('the pill scopes the canvas to a sprint, the backlog, or everything', async ({ page }) => {
        await createBoard(page, `scope-${Date.now()}-${run++}`)
        await page.getByLabel('Board actions').click()
        await page.getByTestId('boards-settings').click()
        await page.getByLabel('Plan work in sprints').click()
        await page.getByTestId('boards-settings-save').click()
        await addCard(page, 0, 'sprint work')
        await addCard(page, 0, 'loose work')

        // With no active sprint the scope falls back to every card, and the
        // pill says so rather than emptying the board.
        await expect(page.getByTestId('boards-sprint-scope')).toContainText('No active sprint')
        await expect(boardCard(page, 'sprint work')).toBeVisible()
        await expect(boardCard(page, 'loose work')).toBeVisible()

        await page.getByTestId('boards-view-backlog').click()
        await page.getByTestId('boards-new-sprint').click()
        await page.getByTestId('boards-sprint-save').click()
        await expect(page.getByTestId(/^boards-section-title-(?!backlog)/).first()).toHaveText(
            'Sprint 1'
        )
        await dragCardToSection(page, row(page, 'sprint work'), 'Sprint 1')
        await expect(sprintSection(page).getByText('sprint work')).toBeVisible()
        await page.getByTestId('boards-view-board').click()

        await page.getByTestId('boards-sprint-scope').click()
        await page.getByTestId('boards-scope-sprint-1').click()
        await expect(boardCard(page, 'sprint work')).toBeVisible()
        await expect(boardCard(page, 'loose work')).toHaveCount(0)
        await expect(page.getByTestId('boards-sprint-scope')).toContainText('Sprint 1')

        await page.getByTestId('boards-sprint-scope').click()
        await page.getByTestId('boards-scope-backlog').click()
        await expect(boardCard(page, 'loose work')).toBeVisible()
        await expect(boardCard(page, 'sprint work')).toHaveCount(0)

        await page.getByTestId('boards-sprint-scope').click()
        await page.getByTestId('boards-scope-all').click()
        await expect(boardCard(page, 'sprint work')).toBeVisible()
        await expect(boardCard(page, 'loose work')).toBeVisible()
    })
})
