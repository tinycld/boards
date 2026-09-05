import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard, dragCardBelow, dragCardToSection } from './helpers'

// The backlog view: sprints are opt-in per board, so every spec enables them
// through Board settings first, then plans a sprint and moves cards into it
// by drag, by the picker and by the `s` shortcut. Every spec creates its own
// uniquely-named board and drives the UI only.

let run = 0
async function freshSprintBoard(page: import('@playwright/test').Page, label: string) {
    const name = `sprint-${label}-${Date.now()}-${run++}`
    await createBoard(page, name)
    await page.getByLabel('Board actions').click()
    await page.getByTestId('boards-settings').click()
    await page.getByLabel('Plan work in sprints').click()
    await page.getByTestId('boards-settings-save').click()
    await expect(page.getByTestId('boards-view-backlog')).toBeVisible()
    return name
}

async function planSprint(page: import('@playwright/test').Page) {
    await page.getByTestId('boards-new-sprint').click()
    await page.getByTestId('boards-sprint-save').click()
    // The new sprint's section, not the backlog's — the backlog was already there.
    await expect(sprintTitle(page)).toHaveText('Sprint 1')
}

const sprintTitle = (page: import('@playwright/test').Page) =>
    page.getByTestId(/^boards-section-title-(?!backlog)/).first()

/** The sprint section's container — not its title, not the receiving marker. */
const sprintSection = (page: import('@playwright/test').Page) =>
    page.getByTestId(/^boards-section-(?!title-|receiving|backlog)/).first()

const row = (page: import('@playwright/test').Page, title: string) =>
    page
        .getByTestId(/^boards-row-/)
        .filter({ hasText: title })
        .first()

test.describe('Boards — backlog and sprints', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
    })

    test('plans a sprint and drags a card into it', async ({ page }) => {
        await freshSprintBoard(page, 'drag')
        await addCard(page, 0, 'alpha')
        await addCard(page, 0, 'beta')

        await page.getByTestId('boards-view-backlog').click()
        await planSprint(page)

        await dragCardToSection(page, row(page, 'alpha'), 'Sprint 1')
        await expect(sprintSection(page).getByText('alpha')).toBeVisible()
        await expect(page.getByTestId('boards-section-backlog').getByText('beta')).toBeVisible()

        // The chip on the card face names the sprint.
        await page.getByTestId('boards-view-board').click()
        await expect(boardCard(page, 'alpha').getByTestId('boards-sprint-chip')).toHaveText(
            'Sprint 1'
        )
        await expect(boardCard(page, 'beta').getByTestId('boards-sprint-chip')).toHaveCount(0)
    })

    test('reorders within a sprint by the shared rank', async ({ page }) => {
        await freshSprintBoard(page, 'reorder')
        await addCard(page, 0, 'one')
        await addCard(page, 0, 'two')
        await page.getByTestId('boards-view-backlog').click()
        await planSprint(page)
        // Each drop is confirmed before the next: drax commits a transfer a
        // frame after the snap, and a drag started over a still-settling
        // section aims at geometry that is about to move.
        await dragCardToSection(page, row(page, 'one'), 'Sprint 1')
        await expect(sprintSection(page).getByText('one')).toBeVisible()
        await dragCardToSection(page, row(page, 'two'), 'Sprint 1')
        await expect(sprintSection(page).getByText('two')).toBeVisible()

        await dragCardBelow(page, row(page, 'one'), row(page, 'two'))
        await expect(sprintSection(page).getByTestId(/^boards-row-/)).toHaveText([/two/, /one/])

        // The canvas shows the same order — one rank, two projections.
        await page.getByTestId('boards-view-board').click()
        const titles = page.getByTestId('boards-card-title')
        await expect(titles).toHaveText(['two', 'one'])
    })

    test('the s shortcut and the picker file a card', async ({ page }) => {
        await freshSprintBoard(page, 'picker')
        await addCard(page, 0, 'keyed')
        await page.getByTestId('boards-view-backlog').click()
        await planSprint(page)

        await page.keyboard.press('j')
        await expect(page.getByTestId(/^boards-focused-/)).toHaveCount(1)
        await page.keyboard.press('s')
        await page.getByTestId('boards-sprint-option-1').click()
        await expect(sprintSection(page).getByText('keyed')).toBeVisible()
    })

    test('filters the board by sprint', async ({ page }) => {
        await freshSprintBoard(page, 'filter')
        await addCard(page, 0, 'in sprint')
        await addCard(page, 0, 'in backlog')
        await page.getByTestId('boards-view-backlog').click()
        await planSprint(page)
        await dragCardToSection(page, row(page, 'in sprint'), 'Sprint 1')
        // The transfer commits a frame after the snap; leaving the view
        // before it lands would unmount the container mid-commit.
        await expect(sprintSection(page).getByText('in sprint')).toBeVisible()

        await page.getByTestId('boards-view-board').click()
        await page.getByTestId('boards-filter-button').click()
        await page.getByRole('checkbox', { name: 'Sprint 1' }).click()
        await page.keyboard.press('Escape')
        await expect(boardCard(page, 'in sprint')).toBeVisible()
        await expect(boardCard(page, 'in backlog')).toHaveCount(0)
    })
})
